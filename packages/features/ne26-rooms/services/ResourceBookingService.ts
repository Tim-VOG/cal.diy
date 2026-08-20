import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { formatSlotRange } from "../lib/teamNotification";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { buildEventSchedule, buildOpenSlotMs, type DurationHours } from "../lib/eventSchedule";
import { type ResolvedAddOnLine, resolveAddOnLines } from "../lib/pricing";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

// How long an unpaid booking holds its slots while the buyer pays.
//
// Stripe refuses a Checkout session expiring in under 30 minutes, and that
// session MUST expire with the hold: otherwise the session stays payable for
// Stripe's 24h default while the hold lapses after 15, so a buyer who pays late
// is charged for a slot that has already been released — and, since expired
// holds are deleted, with no row left to attach the payment to. 35 leaves margin
// for the latency between creating the booking and creating the session.
const HOLD_MINUTES = 35;
const MS_PER_MINUTE = 60 * 1000;


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

    const settings = await this.deps.ne26RoomSettingsRepository.get();
    const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));

    const durationMinutes = input.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(input.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!openSlotMs.has(slot.getTime())) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "Selected time is outside the event opening hours.");
      }
    }
    // The client's grid can be stale — a page left open, a bookmarked link, the
    // hostess tablet sitting on the same screen all morning — so re-check here
    // that the slot has not already started. Admin blocks (createBlock) are
    // deliberately exempt: ops must still be able to block a room mid-event.
    if (input.startUtc.getTime() < Date.now()) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "That time has already started. Please pick a later slot.");
    }
    // Reserve the turnover buffer after the booking so the next one can't start
    // within it. Added to the slot set, so the DB unique index enforces the gap.
    const bufferSlots = getBufferSlotStarts(input.startUtc, durationMinutes, settings.bufferMinutes);

    const endTime = new Date(input.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);
    const roomPrice = { 1: room.price1h, 2: room.price2h, 3: room.price3h }[input.durationHours];

    const addOnLines = await this.resolveAddOnLines(input.addOns ?? [], input.durationHours, room.capacity);
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
   * Prepare a fresh Stripe Checkout for an existing PENDING booking so the booker
   * can finish an abandoned payment from "My bookings". The booking's slots are
   * still reserved at the DB level for as long as the row exists, so this is safe;
   * we extend the hold and rebuild the same line items. Throws if the booking is
   * missing, not the caller's, or no longer PENDING.
   */
  async prepareResume(
    uid: string,
    userId: number
  ): Promise<{
    currency: string;
    checkoutLines: CheckoutLine[];
    /** New hold expiry, so the resumed Checkout session can expire with it. */
    holdExpiresAt: Date;
    slug: string;
    durationHours: DurationHours;
    addOns: { slug: string; quantity: number }[];
  }> {
    const booking = await this.deps.resourceBookingRepository.findResumableByUid(uid);
    if (!booking || booking.bookerUserId !== userId) {
      throw new ErrorWithCode(ErrorCode.NotFound, "Booking not found.");
    }
    if (booking.status !== ResourceBookingStatus.PENDING) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "This booking can no longer be paid.");
    }

    const durationHours = (booking.durationMinutes / 60) as DurationHours;
    const roomPrice = {
      1: booking.resource.price1h,
      2: booking.resource.price2h,
      3: booking.resource.price3h,
    }[durationHours];
    const checkoutLines: CheckoutLine[] = [
      {
        name: `${booking.resource.name} — meeting room (${durationHours}h)`,
        description: formatSlotRange(booking.startTime, booking.endTime),
        quantity: 1,
        unitAmount: roomPrice,
      },
      ...booking.addOns.map((a) => ({
        name: a.addOn.name,
        quantity: a.quantity,
        unitAmount: Math.round(a.lineTotal / a.quantity),
      })),
    ];

    // Give the booker another full hold window to complete payment.
    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * MS_PER_MINUTE);
    await this.deps.resourceBookingRepository.extendHoldByUid(uid, holdExpiresAt);

    return {
      currency: booking.currency,
      checkoutLines,
      // Returned so the resumed Checkout session can be made to expire with it.
      holdExpiresAt,
      slug: booking.resource.slug,
      durationHours,
      addOns: booking.addOns.map((a) => ({ slug: a.addOn.slug, quantity: a.quantity })),
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

    const settings = await this.deps.ne26RoomSettingsRepository.get();
    const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));

    const durationMinutes = input.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(input.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!openSlotMs.has(slot.getTime())) {
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
    durationHours: number,
    roomCapacity: number
  ): Promise<ResolvedAddOnLine[]> {
    if (!requested.length) return [];
    const catalog = await this.deps.addOnRepository.findManyActiveBySlugs(requested.map((a) => a.slug));
    return resolveAddOnLines(requested, catalog, { durationHours, roomCapacity });
  }

}
