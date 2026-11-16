import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getAddOnRepository } from "../di/AddOnRepository.container";
import type { TransactionClient } from "../repositories/Ne26OrderRepository";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "../di/Ne26RoomSettingsRepository.container";
import { getResourceRepository } from "../di/ResourceRepository.container";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { eventDateOf, eventMinuteOfDay } from "../lib/deskDay";
import { buildEventSchedule, buildOpenSlotMs, type DurationHours } from "../lib/eventSchedule";
import { resolveAddOnLines } from "../lib/pricing";
import { tooManyRoomsPerDayMessage } from "../lib/roomsPerDay";
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

/**
 * Fallback cap on rooms per exhibitor per day, whatever the slot.
 *
 * A commercial rule, not a technical guard: with nine rooms and three days, one
 * exhibitor taking several rooms on the same day denies another exhibitor
 * entirely. What keeps two people out of the SAME room is the unique index on
 * (resourceId, slotStart), which this has nothing to do with — raising the cap
 * can oversell an exhibitor, it can never double-book a room.
 *
 * The live value is `Ne26RoomSettings.maxRoomsPerDayPerExhibitor`, because this
 * is a decision an admin takes during the event rather than one that waits for
 * a release. This constant is only what an install with no settings row reads.
 *
 * It is enforced here rather than only in the UI, because the UI is a shortlist
 * held in the browser and anyone can post to the API directly.
 *
 * "Exhibitor" is the account when there is one and the email otherwise, so a
 * walk-in buying twice at the counter is caught the same way — see
 * findBookedStartsForUser.
 */
export const DEFAULT_MAX_ROOMS_PER_DAY = 1;

// The refusal's wording lives with the rest of the cap's sentences, so the
// server and the pages that promise the rule cannot drift apart.
export { tooManyRoomsPerDayMessage };

/**
 * The day is taken by another unpaid hold of the buyer's own, which this basket
 * does not cover in full.
 *
 * Distinct from the rule above because the answer is different: nothing is
 * bought, so there is nothing to cancel with the sales desk — the buyer either
 * pays for that hold or releases it themselves.
 */
export const HOLD_ON_ANOTHER_ORDER_MESSAGE =
  "You are already holding a room that day on another unpaid order. Pay for it or release it first.";

export interface OrderRoomSelection {
  slug: string;
  startUtc: Date;
  durationHours: DurationHours;
  addOns?: { slug: string; quantity: number }[];
}

export interface CreateOrderRequest {
  /**
   * An admin placing this order for an exhibitor who asked for it.
   *
   * Two things follow, and they follow together because they are the same
   * fact. The booking is FIRM — no deadline, nothing releases it for want of
   * payment, because the exhibitor asked for the room and owes it whether or
   * not they turn up. And the rooms-per-day cap does not apply: that rule
   * exists to stop an exhibitor quietly taking more than their share through
   * the public site, and an admin is the control it was protecting.
   */
  adminOnRequest?: boolean;
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

    // One room per day, weighed against what this exhibitor already occupies.
    //
    // A day carrying one of their own unpaid holds is NOT taken: that hold is
    // their basket, and this order replaces it. Counting it as taken is what
    // stopped an exhibitor paying for the very rooms they were holding.
    //
    // The whole rule runs INSIDE the create transaction, under a lock on this
    // buyer — see planUnderLock. Read beforehand, it was not enforced at all:
    // two baskets sent at the same moment both read "no conflict" and both
    // committed, leaving one exhibitor holding two rooms on the same day.
    const basketDays = input.rooms.map((r) => eventDateOf(r.startUtc));
    const wantedDays = new Set(basketDays);
    // How many rooms this basket wants on each day, not merely which days it
    // touches: the cap is a number an admin sets, so a day is no longer either
    // free or spent.
    const basketRoomsPerDay: Record<string, number> = {};
    for (const day of basketDays) basketRoomsPerDay[day] = (basketRoomsPerDay[day] ?? 0) + 1;
    const roomsPerDayCap = settings.maxRoomsPerDayPerExhibitor;
    const cap = input.buyer.userId ? MAX_ACTIVE_ORDERS_PER_USER : MAX_ACTIVE_ORDERS_AT_THE_DESK;

    // Read before the superseded orders are deleted, and used after the new one
    // exists: a payment page still open on a replaced order would take money
    // for rooms that order no longer holds.
    let supersededSessions: string[] = [];

    const planUnderLock = async (tx: TransactionClient): Promise<string[]> => {
      const occupied = await orderRepo.findOccupiedDaysForUser(
        { userId: input.buyer.userId, email: input.buyer.email },
        now,
        tx
      );

      // One row is one room, so these are counts, not flags.
      const paidRoomsPerDay: Record<string, number> = {};
      const daysByHold: Record<string, string[]> = {};
      for (const row of occupied) {
        const day = eventDateOf(row.startTime);
        if (row.paid || !row.orderUid) {
          paidRoomsPerDay[day] = (paidRoomsPerDay[day] ?? 0) + 1;
          continue;
        }
        const days = daysByHold[row.orderUid] ?? [];
        if (!days.includes(day)) days.push(day);
        daysByHold[row.orderUid] = days;
      }

      // Their own unpaid holds are deliberately absent from this sum: the block
      // below replaces them, and counting them would refuse an exhibitor the
      // very rooms they are holding. The consequence is worth stating plainly —
      // above a cap of 1, a second room on the same day has to be in the same
      // basket, or the first one has to be paid for first. Two separate unpaid
      // orders on one day are not a basket being revised, and guessing which of
      // the two it is would either drop a room they still wanted or sell past
      // the cap.
      if (!input.adminOnRequest) {
        for (const day of Object.keys(basketRoomsPerDay)) {
          if ((paidRoomsPerDay[day] ?? 0) + (basketRoomsPerDay[day] ?? 0) > roomsPerDayCap) {
            throw new ErrorWithCode(ErrorCode.BadRequest, tooManyRoomsPerDayMessage(roomsPerDayCap));
          }
        }
      }

      // A hold is replaced only when this basket covers EVERY day it occupies.
      // Replacing a two-day hold with a one-day basket would quietly hand back
      // a room the exhibitor still wanted, and they would not find out until
      // the event.
      const uids: string[] = [];
      for (const uid of Object.keys(daysByHold)) {
        const days = daysByHold[uid];
        if (!days.some((d) => wantedDays.has(d))) continue;
        if (days.every((d) => wantedDays.has(d))) {
          uids.push(uid);
        } else {
          throw new ErrorWithCode(ErrorCode.BadRequest, HOLD_ON_ANOTHER_ORDER_MESSAGE);
        }
      }

      // Holds this order is about to release do not count against the cap, or
      // an exhibitor at the limit could never revise a basket, only abandon it.
      const held =
        (await orderRepo.countActiveHolds(
          { userId: input.buyer.userId, email: input.buyer.email },
          now,
          tx
        )) - uids.length;
      if (held >= cap) {
        throw new ErrorWithCode(
          ErrorCode.BadRequest,
          input.buyer.userId
            ? `You already have ${held} orders awaiting payment. Please complete or cancel one first.`
            : `${held} counter orders are already waiting for payment. Finish or cancel one first.`
        );
      }

      supersededSessions = await orderRepo.findStripeSessionIds(uids, tx);
      return uids;
    };

    const rooms: Awaited<ReturnType<typeof this.priceRoom>>[] = [];
    for (const selection of input.rooms) {
      rooms.push(
        await this.priceRoom(selection, openSlotMs, settings.bufferMinutes, now, settings.cateringSalesOpen)
      );
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

    // Rooms on the same day inside ONE basket, against the same cap. Checked
    // against the priced rooms rather than the request, so it reads the start
    // the server resolved. The check under the lock above is the authoritative
    // one; this one runs first and refuses a basket that cannot pass whatever
    // the exhibitor already owns.
    const roomsPerDayInThisOrder: Record<string, number> = {};
    for (const room of rooms) {
      const day = eventDateOf(room.startTime);
      const inDay = (roomsPerDayInThisOrder[day] ?? 0) + 1;
      if (inDay > roomsPerDayCap && !input.adminOnRequest) {
        throw new ErrorWithCode(ErrorCode.BadRequest, tooManyRoomsPerDayMessage(roomsPerDayCap));
      }
      roomsPerDayInThisOrder[day] = inDay;
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
      holdExpiresAt: input.adminOnRequest
        ? null
        : new Date(now.getTime() + HOLD_MINUTES * MS_PER_MINUTE),
      planUnderLock,
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

    // Only now that the replacement exists. Closing them earlier would strand a
    // buyer whose new basket then failed: no payment page, and a hold they can
    // no longer pay for.
    if (supersededSessions.length > 0) {
      const { getStripeCheckoutService } = await import("../di/StripeCheckoutService.container");
      const stripe = getStripeCheckoutService();
      for (const sessionId of supersededSessions) {
        await stripe.expireSession(sessionId).catch(() => {
          // Already paid or already expired — nothing left to close.
        });
      }
    }

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
    now: Date,
    cateringSalesOpen: boolean
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

    // The one boundary that matters for the catering switch. The pages stop
    // offering it, but a page is not a rule: a basket restored from an open tab,
    // or a request posted straight at the API, arrives here either way.
    if (!cateringSalesOpen && (selection.addOns ?? []).length > 0) {
      throw new ErrorWithCode(
        ErrorCode.BadRequest,
        `${room.name}: catering is no longer on sale — the kitchen's order is already placed. Remove the catering from this room and the room itself can still be booked.`
      );
    }

    const catalogue = await getAddOnRepository().findManyActiveBySlugs(
      (selection.addOns ?? []).map((a) => a.slug)
    );
    const addOnLines = resolveAddOnLines(selection.addOns ?? [], catalogue, {
      durationHours: selection.durationHours,
      roomCapacity: room.capacity,
      roomCategory: room.category,
      // Time of day, so an add-on served only at certain hours cannot be
      // ordered outside them by posting straight to the API.
      slot: {
        startMinute: eventMinuteOfDay(selection.startUtc),
        endMinute: eventMinuteOfDay(selection.startUtc) + durationMinutes,
      },
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
