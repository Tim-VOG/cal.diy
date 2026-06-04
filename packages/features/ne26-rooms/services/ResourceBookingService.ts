import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { EVENT_SCHEDULE, type DurationHours } from "../lib/eventSchedule";
import { computeAddOnLine } from "../lib/pricing";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

const HOLD_MINUTES = 15;
const MS_PER_MINUTE = 60 * 1000;

// Every atomic hour that is actually open for booking across the event.
const SELLABLE_HOUR_MS = new Set(
  EVENT_SCHEDULE.flatMap((day) => day.sellableHourStartsUtc.map((d) => d.getTime()))
);

export interface IResourceBookingServiceDeps {
  resourceRepository: ResourceRepository;
  addOnRepository: AddOnRepository;
  resourceBookingRepository: ResourceBookingRepository;
}

export interface CreateBookingInput {
  slug: string;
  startUtc: Date;
  durationHours: DurationHours;
  booker: { userId: number; email: string; name: string };
  addOns?: { slug: string; quantity: number }[];
}

export interface CreatedBooking {
  uid: string;
  roomName: string;
  amountTotal: number;
  currency: string;
  status: ResourceBookingStatus;
  holdExpiresAt: Date;
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
      if (!SELLABLE_HOUR_MS.has(slot.getTime())) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "Selected time is outside the event opening hours.");
      }
    }
    const endTime = new Date(input.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);
    const roomPrice = { 1: room.price1h, 2: room.price2h, 3: room.price3h }[input.durationHours];

    const addOnLines = await this.resolveAddOnLines(input.addOns ?? [], input.durationHours);
    const amountTotal = roomPrice + addOnLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * MS_PER_MINUTE);

    const booking = await this.deps.resourceBookingRepository.createWithSlots({
      resourceId: room.id,
      startTime: input.startUtc,
      endTime,
      durationMinutes,
      slotStarts,
      bookerUserId: input.booker.userId,
      bookerEmail: input.booker.email,
      bookerName: input.booker.name,
      amountTotal,
      currency: room.currency,
      status: ResourceBookingStatus.PENDING,
      holdExpiresAt,
      addOns: addOnLines,
    });

    return { uid: booking.uid, roomName: room.name, amountTotal, currency: room.currency, status: booking.status, holdExpiresAt };
  }

  /**
   * Mark a booking paid (called from the Stripe webhook). Idempotent: returns
   * false if the booking was already confirmed, cancelled, or no longer exists
   * (e.g. its hold expired and it was reclaimed before payment landed).
   */
  async confirmPayment(input: { bookingUid: string; stripePaymentId: string }): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.markConfirmedByUid(input.bookingUid, input.stripePaymentId);
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
  ): Promise<{ addOnId: number; quantity: number; unitPrice: number; lineTotal: number }[]> {
    if (!requested.length) return [];

    const catalog = await this.deps.addOnRepository.findManyActiveBySlugs(requested.map((a) => a.slug));
    const bySlug = new Map(catalog.map((a) => [a.slug, a]));

    return requested.map((req) => {
      const addOn = bySlug.get(req.slug);
      if (!addOn) {
        throw new ErrorWithCode(ErrorCode.BadRequest, `Unknown or inactive add-on "${req.slug}"`);
      }
      const { quantity, lineTotal } = computeAddOnLine(addOn.priceType, addOn.price, req.quantity, durationHours);
      return { addOnId: addOn.id, quantity, unitPrice: addOn.price, lineTotal };
    });
  }
}
