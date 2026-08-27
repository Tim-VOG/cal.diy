import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getAddOnRepository } from "../di/AddOnRepository.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "../di/Ne26RoomSettingsRepository.container";
import { getResourceRepository } from "../di/ResourceRepository.container";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { type DurationHours, buildEventSchedule, buildOpenSlotMs } from "../lib/eventSchedule";
import { resolveAddOnLines } from "../lib/pricing";
import { formatSlotRange } from "../lib/teamNotification";

const MS_PER_MINUTE = 60 * 1000;

/**
 * How long an order is held before payment.
 *
 * Stripe refuses a Checkout session shorter than 30 minutes, and the hold has to
 * outlive the session or a buyer can pay for a room that was already released.
 * 35 leaves margin for the latency between creating the order and creating the
 * session.
 */
const HOLD_MINUTES = 35;

/** Unpaid orders one account may hold at once. Each takes rooms off sale. */
const MAX_ACTIVE_ORDERS_PER_USER = 3;

/** The same, for the welcome desk, which sells to people with no account. */
const MAX_ACTIVE_ORDERS_AT_THE_DESK = 6;

export interface OrderRoomSelection {
  slug: string;
  startUtc: Date;
  durationHours: DurationHours;
  addOns?: { slug: string; quantity: number }[];
}

export interface CreateOrderRequest {
  buyer: { userId: number | null; email: string; name: string };
  billing?: {
    country?: string | null;
    vatNumber?: string | null;
    poNumber?: string | null;
    internalReference?: string | null;
  };
  rooms: OrderRoomSelection[];
}

export interface CheckoutLine {
  name: string;
  description?: string;
  quantity: number;
  unitAmount: number;
}

/**
 * Turn a basket of rooms into one held order.
 *
 * Everything the single-room path validated is validated per room here — the
 * opening hours, the start not being in the past, the add-on catalogue and the
 * per-person cap — and then all the rooms are held in one transaction, so a
 * clash on the last one cannot leave the others locked.
 */
export class Ne26OrderService {
  async createOrder(input: CreateOrderRequest) {
    if (input.rooms.length === 0) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "Choose at least one room.");
    }

    const orderRepo = getNe26OrderRepository();
    const settings = await getNe26RoomSettingsRepository().get();
    const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));
    const now = new Date();

    const held = await orderRepo.countActiveHolds(input.buyer.userId, now);
    const cap = input.buyer.userId ? MAX_ACTIVE_ORDERS_PER_USER : MAX_ACTIVE_ORDERS_AT_THE_DESK;
    if (held >= cap) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        input.buyer.userId
          ? `You already have ${held} orders awaiting payment. Please complete or cancel one first.`
          : `${held} counter orders are already waiting for payment. Finish or cancel one first.`
      );
    }

    const rooms: Awaited<ReturnType<typeof this.priceRoom>>[] = [];
    for (const selection of input.rooms) {
      rooms.push(await this.priceRoom(selection, openSlotMs, settings.bufferMinutes, now));
    }

    // The same room twice at overlapping times would otherwise only be caught by
    // the slot index, as a "somebody took it" error naming nobody.
    const seen = new Set<string>();
    for (const room of rooms) {
      for (const slot of room.slotStarts) {
        const key = `${room.resourceId}@${slot.getTime()}`;
        if (seen.has(key)) {
          throw new ErrorWithCode(
            ErrorCode.BadRequest,
            `${room.roomName} appears twice in this order at overlapping times.`
          );
        }
        seen.add(key);
      }
    }

    const amountTotal = rooms.reduce((sum, r) => sum + r.amountTotal, 0);
    const currency = rooms[0].currency;

    const order = await orderRepo.createWithRooms({
      bookerUserId: input.buyer.userId,
      bookerEmail: input.buyer.email,
      bookerName: input.buyer.name,
      bookerCountry: input.billing?.country ?? null,
      bookerVatNumber: input.billing?.vatNumber ?? null,
      bookerPoNumber: input.billing?.poNumber ?? null,
      bookerInternalReference: input.billing?.internalReference ?? null,
      amountTotal,
      currency,
      holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * MS_PER_MINUTE),
      rooms: rooms.map((r) => ({
        resourceId: r.resourceId,
        startTime: r.startTime,
        endTime: r.endTime,
        durationMinutes: r.durationMinutes,
        slotStarts: [...r.slotStarts, ...r.bufferSlots],
        amountTotal: r.amountTotal,
        addOns: r.addOnLines,
      })),
    });

    if (!order) throw new ErrorWithCode(ErrorCode.InternalServerError, "Order could not be created");

    const checkoutLines: CheckoutLine[] = rooms.flatMap((r) => [
      {
        name: `${r.roomName} — meeting room (${r.durationMinutes / 60}h)`,
        description: r.slotLabel,
        quantity: 1,
        unitAmount: r.roomPrice,
      },
      ...r.addOnLines.map((line) => ({
        name: `${r.roomName} · ${line.name}`,
        quantity: line.quantity,
        unitAmount: line.unitPrice,
      })),
    ]);

    return { order, checkoutLines };
  }

  /** Validate and price one room of the basket. */
  private async priceRoom(
    selection: OrderRoomSelection,
    openSlotMs: ReadonlySet<number>,
    bufferMinutes: number,
    now: Date
  ) {
    const room = await getResourceRepository().findBySlug(selection.slug);
    if (!room || !room.isActive) {
      throw new ErrorWithCode(ErrorCode.NotFound, `Room "${selection.slug}" not found`);
    }

    const durationMinutes = selection.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(selection.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!openSlotMs.has(slot.getTime())) {
        throw new ErrorWithCode(
          ErrorCode.BadRequest,
          `${room.name}: that time is outside the event opening hours.`
        );
      }
    }
    // The client's grid can be stale — a page left open, a shortlist restored
    // hours later — so the start is re-checked against now, not trusted.
    if (selection.startUtc.getTime() < now.getTime()) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        `${room.name}: that time has already started. Please pick a later slot.`
      );
    }

    const catalogue = await getAddOnRepository().findManyActiveBySlugs(
      (selection.addOns ?? []).map((a) => a.slug)
    );
    const addOnLines = resolveAddOnLines(selection.addOns ?? [], catalogue, {
      durationHours: selection.durationHours,
      roomCapacity: room.capacity,
    });

    const roomPrice = { 1: room.price1h, 2: room.price2h, 3: room.price3h }[selection.durationHours];
    const endTime = new Date(selection.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);

    return {
      resourceId: room.id,
      roomName: room.name,
      startTime: selection.startUtc,
      endTime,
      durationMinutes,
      slotStarts,
      // Reserved after the booking so the next one cannot start inside the
      // cleaning gap; part of the slot set, so the DB enforces it.
      bufferSlots: getBufferSlotStarts(selection.startUtc, durationMinutes, bufferMinutes),
      roomPrice,
      addOnLines,
      amountTotal: roomPrice + addOnLines.reduce((sum, l) => sum + l.lineTotal, 0),
      currency: room.currency,
      slotLabel: formatSlotRange(selection.startUtc, endTime),
    };
  }
}
