import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

export interface CreateResourceBookingWithSlotsInput {
  resourceId: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  /** Atomic 1h slot starts covering [startTime, endTime). Computed by the caller. */
  slotStarts: Date[];
  bookerEmail: string;
  bookerName: string;
  bookerUserId?: number | null;
  amountTotal: number;
  currency?: string;
  status?: ResourceBookingStatus;
  holdExpiresAt?: Date | null;
  /** Add-on lines, with prices already frozen by the caller. */
  addOns?: { addOnId: number; quantity: number; unitPrice: number; lineTotal: number }[];
}

export class ResourceBookingRepository {
  constructor(private prismaClient: PrismaClient) {}

  /**
   * Persist a booking and its atomic 1h slots in a single transaction. The
   * @@unique([resourceId, slotStart]) index makes any colliding slot insert
   * fail with P2002, rolling back the whole booking. This is the DB-level
   * guarantee that two confirmed/held bookings can never share a room+hour —
   * the display layer may briefly lie under a race, the database never does.
   */
  async createWithSlots(input: CreateResourceBookingWithSlotsInput) {
    const now = new Date();
    try {
      return await this.prismaClient.$transaction(async (tx) => {
        // Reclaim abandoned holds: a PENDING booking whose hold has expired no
        // longer protects its slots, but its ResourceSlot rows still occupy the
        // unique index. Delete the expired ones covering any requested slot
        // (cascades their slots) so the new booking can take them.
        const expiredHolds = await tx.resourceBooking.findMany({
          where: {
            resourceId: input.resourceId,
            status: ResourceBookingStatus.PENDING,
            holdExpiresAt: { lt: now },
            slots: { some: { slotStart: { in: input.slotStarts } } },
          },
          select: { id: true },
        });
        if (expiredHolds.length > 0) {
          await tx.resourceBooking.deleteMany({ where: { id: { in: expiredHolds.map((b) => b.id) } } });
        }

        const booking = await tx.resourceBooking.create({
          data: {
            resourceId: input.resourceId,
            startTime: input.startTime,
            endTime: input.endTime,
            durationMinutes: input.durationMinutes,
            bookerEmail: input.bookerEmail,
            bookerName: input.bookerName,
            bookerUserId: input.bookerUserId ?? null,
            amountTotal: input.amountTotal,
            currency: input.currency,
            status: input.status,
            holdExpiresAt: input.holdExpiresAt ?? null,
          },
          select: {
            id: true,
            uid: true,
            status: true,
            startTime: true,
            endTime: true,
            amountTotal: true,
          },
        });

        await tx.resourceSlot.createMany({
          data: input.slotStarts.map((slotStart) => ({
            resourceId: input.resourceId,
            bookingId: booking.id,
            slotStart,
          })),
        });

        if (input.addOns?.length) {
          await tx.bookingAddOn.createMany({
            data: input.addOns.map((addOn) => ({
              bookingId: booking.id,
              addOnId: addOn.addOnId,
              quantity: addOn.quantity,
              unitPrice: addOn.unitPrice,
              lineTotal: addOn.lineTotal,
            })),
          });
        }

        return booking;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ErrorWithCode(
          ErrorCode.BookingConflict,
          "This time slot is no longer available for the selected room."
        );
      }
      throw e;
    }
  }

  /**
   * Atomic hour starts currently occupied for a room: confirmed bookings, plus
   * pending ones whose hold has not yet expired. An expired pending hold frees
   * its slots for display (the row stays until cleanup but no longer blocks).
   */
  async findActiveSlotStarts(resourceId: number, now: Date): Promise<Date[]> {
    const slots = await this.prismaClient.resourceSlot.findMany({
      where: {
        resourceId,
        booking: {
          OR: [
            { status: ResourceBookingStatus.CONFIRMED },
            { status: ResourceBookingStatus.PENDING, holdExpiresAt: { gt: now } },
          ],
        },
      },
      select: { slotStart: true },
    });
    return slots.map((slot) => slot.slotStart);
  }

  findByUid(uid: string) {
    return this.prismaClient.resourceBooking.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        amountTotal: true,
        currency: true,
        bookerUserId: true,
        holdExpiresAt: true,
        invoiceNumber: true,
        resource: { select: { name: true, slug: true } },
      },
    });
  }

  /**
   * Confirm a paid booking. Scoped to PENDING so a replayed/duplicate webhook is
   * a no-op (idempotent) and a cancelled booking is never silently revived.
   * Returns the number of rows updated (1 = confirmed, 0 = already handled/gone).
   */
  async markConfirmedByUid(uid: string, stripePaymentId: string): Promise<number> {
    const result = await this.prismaClient.resourceBooking.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      data: { status: ResourceBookingStatus.CONFIRMED, stripePaymentId },
    });
    return result.count;
  }
}
