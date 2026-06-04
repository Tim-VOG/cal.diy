import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { type DurationHours, OPEN_SLOT_MS } from "../lib/eventSchedule";
import { computeAddOnLine } from "../lib/pricing";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

const HOLD_MINUTES = 15;
const MS_PER_MINUTE = 60 * 1000;

// Human, Brussels-time slot label for the Stripe Checkout line (e.g.
// "Tue 17 Nov 2026, 14:00–16:00 (Europe/Brussels)").
function formatSlotRange(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}-${time(end)} (Europe/Brussels)`;
}

export interface IResourceBookingServiceDeps {
  resourceRepository: ResourceRepository;
  addOnRepository: AddOnRepository;
  resourceBookingRepository: ResourceBookingRepository;
  ne26RoomSettingsRepository: Ne26RoomSettingsRepository;
}

export interface CreateBookingInput {
  slug: string;
  startUtc: Date;
  durationHours: DurationHours;
  booker: { userId: number; email: string; name: string };
  addOns?: { slug: string; quantity: number }[];
  /** Billing from the exhibitor's saved profile; seeds the invoice VAT. Stripe
   * confirms it at checkout and the webhook syncs any change back. */
  billing?: { country?: string | null; vatNumber?: string | null };
}

export interface CheckoutLine {
  name: string;
  description?: string;
  quantity: number;
  unitAmount: number; // cents
}

export interface CreatedBooking {
  uid: string;
  roomName: string;
  amountTotal: number;
  currency: string;
  status: ResourceBookingStatus;
  holdExpiresAt: Date;
  /** Itemised lines for the Stripe Checkout summary (room + each add-on). */
  checkoutLines: CheckoutLine[];
}

export class ResourceBookingService {
  constructor(private deps: IResourceBookingServiceDeps) {}

  /**
   * Create a PENDING booking with a temporary hold. Price is the room's price
   * for the chosen duration plus the add-on lines (frozen here). The atomic
   * slots are written transactionally, so a concurrent booking on any shared
   * hour is rejected by the DB (surfaced as a BookingConflict).
   */
  async createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
    const room = await this.deps.resourceRepository.findBySlug(input.slug);
    if (!room || !room.isActive) {
      throw new ErrorWithCode(ErrorCode.NotFound, `Room "${input.slug}" not found`);
    }

    const durationMinutes = input.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(input.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!OPEN_SLOT_MS.has(slot.getTime())) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "Selected time is outside the event opening hours.");
      }
    }
    // Reserve the turnover buffer after the booking so the next one can't start
    // within it. Added to the slot set, so the DB unique index enforces the gap.
    const { bufferMinutes } = await this.deps.ne26RoomSettingsRepository.get();
    const bufferSlots = getBufferSlotStarts(input.startUtc, durationMinutes, bufferMinutes);

    const endTime = new Date(input.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);
    const roomPrice = { 1: room.price1h, 2: room.price2h, 3: room.price3h }[input.durationHours];

    const addOnLines = await this.resolveAddOnLines(input.addOns ?? [], input.durationHours);
    const amountTotal = roomPrice + addOnLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * MS_PER_MINUTE);

    const checkoutLines: CheckoutLine[] = [
      {
        name: `${room.name} — meeting room (${input.durationHours}h)`,
        description: formatSlotRange(input.startUtc, endTime),
        quantity: 1,
        unitAmount: roomPrice,
      },
      ...addOnLines.map((line) => ({ name: line.name, quantity: line.quantity, unitAmount: line.unitPrice })),
    ];

    const booking = await this.deps.resourceBookingRepository.createWithSlots({
      resourceId: room.id,
      startTime: input.startUtc,
      endTime,
      durationMinutes,
      slotStarts: [...slotStarts, ...bufferSlots],
      bookerUserId: input.booker.userId,
      bookerEmail: input.booker.email,
      bookerName: input.booker.name,
      bookerCountry: input.billing?.country ?? null,
      bookerVatNumber: input.billing?.vatNumber ?? null,
      amountTotal,
      currency: room.currency,
      status: ResourceBookingStatus.PENDING,
      holdExpiresAt,
      addOns: addOnLines,
    });

    return {
      uid: booking.uid,
      roomName: room.name,
      amountTotal,
      currency: room.currency,
      status: booking.status,
      holdExpiresAt,
      checkoutLines,
    };
  }

  /**
   * Mark a booking paid (called from the Stripe webhook). Idempotent: returns
   * false if the booking was already confirmed, cancelled, or no longer exists
   * (e.g. its hold expired and it was reclaimed before payment landed).
   */
  async confirmPayment(input: { bookingUid: string; stripePaymentId: string }): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.markConfirmedByUid(
      input.bookingUid,
      input.stripePaymentId
    );
    return count > 0;
  }

  /** Admin: confirm a PENDING booking paid outside Stripe. Idempotent. */
  async confirmManually(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.confirmManuallyByUid(uid);
    return count > 0;
  }

  /** Admin: cancel a PENDING booking (no credit note) and free its slots. */
  async cancelPending(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.cancelPendingByUid(uid);
    return count > 0;
  }

  /**
   * Admin: block a room on a slot (maintenance / internal use). Occupies the
   * atomic hours like a confirmed booking — the DB rejects a block that overlaps
   * an existing booking (surfaced as a BookingConflict).
   */
  async createBlock(input: { slug: string; startUtc: Date; durationHours: DurationHours }): Promise<void> {
    const room = await this.deps.resourceRepository.findBySlug(input.slug);
    if (!room) throw new ErrorWithCode(ErrorCode.NotFound, `Room "${input.slug}" not found`);

    const durationMinutes = input.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(input.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!OPEN_SLOT_MS.has(slot.getTime())) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "Selected time is outside the event opening hours.");
      }
    }
    const endTime = new Date(input.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);

    await this.deps.resourceBookingRepository.createWithSlots({
      resourceId: room.id,
      startTime: input.startUtc,
      endTime,
      durationMinutes,
      slotStarts,
      bookerEmail: "block@ne26.internal",
      bookerName: "BLOCKED (admin)",
      amountTotal: 0,
      currency: room.currency,
      status: ResourceBookingStatus.CONFIRMED,
      isBlock: true,
    });
  }

  listBlocks() {
    return this.deps.resourceBookingRepository.findBlocks();
  }

  async removeBlock(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.removeBlockByUid(uid);
    return count > 0;
  }

  /** Persist billing details collected by Stripe Checkout (before confirming). */
  async applyCheckoutBilling(input: {
    bookingUid: string;
    country: string | null;
    vatNumber: string | null;
    name: string | null;
  }): Promise<void> {
    await this.deps.resourceBookingRepository.updateBillingFromCheckout(input.bookingUid, {
      country: input.country,
      vatNumber: input.vatNumber,
      name: input.name,
    });
  }

  private async resolveAddOnLines(
    requested: { slug: string; quantity: number }[],
    durationHours: number
  ): Promise<{ addOnId: number; name: string; quantity: number; unitPrice: number; lineTotal: number }[]> {
    if (!requested.length) return [];

    const catalog = await this.deps.addOnRepository.findManyActiveBySlugs(requested.map((a) => a.slug));
    const bySlug = new Map(catalog.map((a) => [a.slug, a]));

    return requested.map((req) => {
      const addOn = bySlug.get(req.slug);
      if (!addOn) {
        throw new ErrorWithCode(ErrorCode.BadRequest, `Unknown or inactive add-on "${req.slug}"`);
      }
      const { quantity, lineTotal } = computeAddOnLine(
        addOn.priceType,
        addOn.price,
        req.quantity,
        durationHours
      );
      return { addOnId: addOn.id, name: addOn.name, quantity, unitPrice: addOn.price, lineTotal };
    });
  }
}
