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
  bookerCountry?: string | null;
  bookerVatNumber?: string | null;
  amountTotal: number;
  currency?: string;
  status?: ResourceBookingStatus;
  holdExpiresAt?: Date | null;
  /** Admin block rather than a real sale. */
  isBlock?: boolean;
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
          // Restate the predicate on the DELETE itself — never trust the ids from
          // the SELECT alone. Under READ COMMITTED, a DELETE that meets a row
          // version changed by a concurrent transaction re-evaluates its own
          // WHERE against the NEW version. An id-only WHERE therefore still
          // matches a hold the Stripe webhook has just flipped to CONFIRMED, and
          // would delete a PAID booking (cascading its slots) to free the slot
          // for this one. With the predicate restated, Postgres skips that row,
          // our slot insert hits @@unique([resourceId, slotStart]) and we raise
          // BookingConflict instead of silently reselling a paid slot.
          await tx.resourceBooking.deleteMany({
            where: {
              id: { in: expiredHolds.map((b) => b.id) },
              status: ResourceBookingStatus.PENDING,
              holdExpiresAt: { lt: now },
            },
          });
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
            bookerCountry: input.bookerCountry ?? null,
            bookerVatNumber: input.bookerVatNumber ?? null,
            amountTotal: input.amountTotal,
            currency: input.currency,
            status: input.status,
            holdExpiresAt: input.holdExpiresAt ?? null,
            isBlock: input.isBlock ?? false,
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
        invoicePdfUrl: true,
        creditNoteNumber: true,
        creditNotePdfUrl: true,
        resource: { select: { name: true, slug: true } },
      },
    });
  }

  /** A PENDING booking with everything needed to rebuild its Stripe checkout. */
  findResumableByUid(uid: string) {
    return this.prismaClient.resourceBooking.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        currency: true,
        bookerUserId: true,
        holdExpiresAt: true,
        resource: {
          select: { name: true, slug: true, price1h: true, price2h: true, price3h: true },
        },
        addOns: {
          select: { quantity: true, lineTotal: true, addOn: { select: { name: true, slug: true } } },
        },
      },
    });
  }

  /** Extend a PENDING booking's hold (e.g. when the booker resumes payment). */
  async extendHoldByUid(uid: string, until: Date): Promise<void> {
    await this.prismaClient.resourceBooking.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      data: { holdExpiresAt: until },
    });
  }

  /**
   * Delete PENDING bookings whose hold has expired, freeing their slots
   * (cascade). Called opportunistically on list reads so abandoned, unpaid
   * bookings disappear ~after the hold window instead of lingering. Returns the
   * number removed.
   */
  async deleteExpiredHolds(now: Date): Promise<number> {
    const result = await this.prismaClient.resourceBooking.deleteMany({
      where: {
        status: ResourceBookingStatus.PENDING,
        holdExpiresAt: { not: null, lt: now },
      },
    });
    return result.count;
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

  /** Store the billing details Stripe Checkout collected, on the still-held booking. */
  async updateBillingFromCheckout(
    uid: string,
    data: { country: string | null; vatNumber: string | null; name: string | null }
  ): Promise<void> {
    await this.prismaClient.resourceBooking.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      data: {
        bookerCountry: data.country ?? undefined,
        bookerVatNumber: data.vatNumber ?? undefined,
        ...(data.name ? { bookerName: data.name } : {}),
      },
    });
  }

  /**
   * Admin: confirm a PENDING booking that was paid outside Stripe (e.g. bank
   * transfer). Scoped to PENDING so it's idempotent and never revives a
   * cancelled booking. Its slots already exist, so no re-insert is needed.
   */
  async confirmManuallyByUid(uid: string): Promise<number> {
    const result = await this.prismaClient.resourceBooking.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      data: { status: ResourceBookingStatus.CONFIRMED },
    });
    return result.count;
  }

  /**
   * Admin: cancel a PENDING booking without a credit note (test booking, unpaid
   * no-show) and free its atomic slots. Scoped to PENDING — a paid/CONFIRMED
   * booking must go through the credit-note flow instead. Returns rows updated.
   */
  async cancelPendingByUid(uid: string): Promise<number> {
    return this.prismaClient.$transaction(async (tx) => {
      const result = await tx.resourceBooking.updateMany({
        where: { uid, status: ResourceBookingStatus.PENDING },
        data: { status: ResourceBookingStatus.CANCELLED },
      });
      if (result.count > 0) {
        const booking = await tx.resourceBooking.findUnique({ where: { uid }, select: { id: true } });
        if (booking) await tx.resourceSlot.deleteMany({ where: { bookingId: booking.id } });
      }
      return result.count;
    });
  }

  /** A single booking with everything the admin detail view shows. */
  findByUidForAdmin(uid: string) {
    return this.prismaClient.resourceBooking.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        bookerName: true,
        bookerEmail: true,
        bookerUserId: true,
        bookerCountry: true,
        bookerVatNumber: true,
        amountTotal: true,
        currency: true,
        stripePaymentId: true,
        invoiceNumber: true,
        invoicePdfUrl: true,
        creditNoteNumber: true,
        creditNotePdfUrl: true,
        holdExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        resource: { select: { name: true, slug: true, category: true } },
        addOns: {
          select: { quantity: true, unitPrice: true, lineTotal: true, addOn: { select: { name: true } } },
        },
      },
    });
  }

  /** All real bookings (excluding admin blocks) with details, for the dashboard. */
  findAllWithDetails() {
    return this.prismaClient.resourceBooking.findMany({
      where: { isBlock: false },
      orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        bookerName: true,
        bookerEmail: true,
        amountTotal: true,
        currency: true,
        stripePaymentId: true,
        invoiceNumber: true,
        creditNoteNumber: true,
        createdAt: true,
        resource: { select: { name: true, slug: true, category: true } },
        addOns: { select: { quantity: true, lineTotal: true, addOn: { select: { name: true } } } },
      },
    });
  }

  /** A single exhibitor's own bookings (excluding admin blocks), with details. */
  findByBookerUserIdWithDetails(userId: number) {
    return this.prismaClient.resourceBooking.findMany({
      where: { isBlock: false, bookerUserId: userId },
      orderBy: [{ startTime: "asc" }, { createdAt: "asc" }],
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        amountTotal: true,
        currency: true,
        invoiceNumber: true,
        creditNoteNumber: true,
        resource: { select: { name: true, category: true } },
        addOns: { select: { quantity: true, addOn: { select: { name: true } } } },
      },
    });
  }

  /** Booking with everything the invoice needs (booker, room, add-on VAT rates). */
  findByUidForInvoice(uid: string) {
    return this.prismaClient.resourceBooking.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        bookerUserId: true,
        bookerName: true,
        bookerEmail: true,
        bookerCountry: true,
        bookerVatNumber: true,
        amountTotal: true,
        currency: true,
        invoiceNumber: true,
        creditNoteNumber: true,
        createdAt: true,
        resource: { select: { name: true } },
        addOns: {
          select: { quantity: true, lineTotal: true, addOn: { select: { name: true, vatRate: true } } },
        },
      },
    });
  }

  /** Allocate the next gap-tolerant invoice number, e.g. NE26-2026-0001. */
  async allocateInvoiceNumber(): Promise<string> {
    const rows = await this.prismaClient.$queryRaw<
      { n: number }[]
    >`SELECT nextval('ne26_invoice_seq')::int AS n`;
    return `NE26-2026-${String(rows[0].n).padStart(4, "0")}`;
  }

  async setInvoice(uid: string, invoiceNumber: string, invoicePdfUrl: string): Promise<void> {
    await this.prismaClient.resourceBooking.update({
      where: { uid },
      data: { invoiceNumber, invoicePdfUrl },
    });
  }

  async allocateCreditNoteNumber(): Promise<string> {
    const rows = await this.prismaClient.$queryRaw<
      { n: number }[]
    >`SELECT nextval('ne26_credit_note_seq')::int AS n`;
    return `NE26-CN-2026-${String(rows[0].n).padStart(4, "0")}`;
  }

  /** Resolve a booking uid from the Stripe payment intent (for refund webhooks). */
  async findUidByStripePaymentId(stripePaymentId: string): Promise<string | null> {
    const row = await this.prismaClient.resourceBooking.findFirst({
      where: { stripePaymentId },
      select: { uid: true },
    });
    return row?.uid ?? null;
  }

  /**
   * Record a credit note and cancel the booking in one transaction. Only acts on
   * a CONFIRMED, not-yet-credited booking (idempotent). Its atomic slots are
   * deleted so the freed room+hour can be booked again. Returns rows updated.
   */
  async creditNoteAndCancel(
    uid: string,
    creditNoteNumber: string,
    creditNotePdfUrl: string
  ): Promise<number> {
    return this.prismaClient.$transaction(async (tx) => {
      const result = await tx.resourceBooking.updateMany({
        where: { uid, status: ResourceBookingStatus.CONFIRMED, creditNoteNumber: null },
        data: { status: ResourceBookingStatus.CANCELLED, creditNoteNumber, creditNotePdfUrl },
      });
      if (result.count > 0) {
        const booking = await tx.resourceBooking.findUnique({ where: { uid }, select: { id: true } });
        if (booking) await tx.resourceSlot.deleteMany({ where: { bookingId: booking.id } });
      }
      return result.count;
    });
  }

  /** All current admin blocks (room + period), most recent first. */
  findBlocks() {
    return this.prismaClient.resourceBooking.findMany({
      where: { isBlock: true, status: ResourceBookingStatus.CONFIRMED },
      orderBy: [{ startTime: "asc" }],
      select: {
        uid: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        resource: { select: { name: true } },
      },
    });
  }

  /** Delete an admin block and free its slots (cascade). No-op for non-blocks. */
  async removeBlockByUid(uid: string): Promise<number> {
    const result = await this.prismaClient.resourceBooking.deleteMany({
      where: { uid, isBlock: true },
    });
    return result.count;
  }
}
