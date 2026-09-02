import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

export interface OrderRoomInput {
  resourceId: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  /** Atomic slot marks the room occupies, buffer included. */
  slotStarts: Date[];
  amountTotal: number;
  addOns: { addOnId: number; quantity: number; unitPrice: number; lineTotal: number; vatRate: number }[];
}

export interface CreateOrderInput {
  bookerUserId: number | null;
  bookerEmail: string;
  bookerName: string;
  bookerCountry?: string | null;
  bookerVatNumber?: string | null;
  bookerPoNumber?: string | null;
  bookerInternalReference?: string | null;
  amountTotal: number;
  currency: string;
  holdExpiresAt: Date;
  rooms: OrderRoomInput[];
}

export class Ne26OrderRepository {
  constructor(private prismaClient: PrismaClient) {}

  /**
   * Hold every room in the order, or none of them.
   *
   * One transaction covering all the rooms is the whole point: if the third room
   * is taken while the buyer was choosing, the first two must not stay held —
   * they would be silently locked for 35 minutes on an order that never
   * existed. The DB unique index on (resourceId, slotStart) is what detects the
   * clash; the rollback is what keeps the other rooms sellable.
   */
  async createWithRooms(input: CreateOrderInput) {
    const now = new Date();
    try {
      return await this.prismaClient.$transaction(async (tx) => {
        const order = await tx.ne26Order.create({
          data: {
            bookerUserId: input.bookerUserId,
            bookerEmail: input.bookerEmail,
            bookerName: input.bookerName,
            bookerCountry: input.bookerCountry ?? null,
            bookerVatNumber: input.bookerVatNumber ?? null,
            bookerPoNumber: input.bookerPoNumber ?? null,
            bookerInternalReference: input.bookerInternalReference ?? null,
            amountTotal: input.amountTotal,
            currency: input.currency,
            status: ResourceBookingStatus.PENDING,
            holdExpiresAt: input.holdExpiresAt,
          },
          select: { uid: true },
        });

        for (const room of input.rooms) {
          // Reclaim abandoned holds covering these slots. Same reasoning as the
          // single-room path: an expired PENDING hold no longer protects its
          // slots, but its rows still occupy the unique index.
          //
          // The predicate is restated on the DELETE rather than deleting by id.
          // Under READ COMMITTED a DELETE that meets a row version changed by a
          // concurrent transaction re-evaluates its own WHERE against the NEW
          // version, so an id-only WHERE would still match a hold the Stripe
          // webhook has just confirmed — and delete a PAID booking to free the
          // slot for this one.
          const expired = await tx.resourceBooking.findMany({
            where: {
              resourceId: room.resourceId,
              status: ResourceBookingStatus.PENDING,
              holdExpiresAt: { lt: now },
              slots: { some: { slotStart: { in: room.slotStarts } } },
            },
            select: { id: true },
          });
          if (expired.length > 0) {
            await tx.resourceBooking.deleteMany({
              where: {
                id: { in: expired.map((b) => b.id) },
                status: ResourceBookingStatus.PENDING,
                holdExpiresAt: { lt: now },
              },
            });
          }

          const booking = await tx.resourceBooking.create({
            data: {
              orderUid: order.uid,
              resourceId: room.resourceId,
              startTime: room.startTime,
              endTime: room.endTime,
              durationMinutes: room.durationMinutes,
              bookerUserId: input.bookerUserId,
              bookerEmail: input.bookerEmail,
              bookerName: input.bookerName,
              bookerCountry: input.bookerCountry ?? null,
              bookerVatNumber: input.bookerVatNumber ?? null,
              amountTotal: room.amountTotal,
              currency: input.currency,
              status: ResourceBookingStatus.PENDING,
              holdExpiresAt: input.holdExpiresAt,
            },
            select: { id: true, uid: true },
          });

          await tx.resourceSlot.createMany({
            data: room.slotStarts.map((slotStart) => ({
              resourceId: room.resourceId,
              slotStart,
              bookingId: booking.id,
            })),
          });

          if (room.addOns.length > 0) {
            await tx.bookingAddOn.createMany({
              // Explicit columns, not a spread: the priced line also carries the
              // add-on's name for the checkout summary, which is not a column.
              data: room.addOns.map((a) => ({
                bookingId: booking.id,
                addOnId: a.addOnId,
                quantity: a.quantity,
                unitPrice: a.unitPrice,
                lineTotal: a.lineTotal,
                vatRate: a.vatRate,
              })),
            });
          }
        }

        return this.findByUid(order.uid, tx);
      });
    } catch (e) {
      // P2002 on (resourceId, slotStart): somebody took one of these rooms while
      // the buyer was deciding. Every room in the order rolled back with it.
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        throw new ErrorWithCode(
          ErrorCode.BookingConflict,
          "One of those rooms was just taken. Nothing was held — please pick again."
        );
      }
      throw e;
    }
  }

  /** `client` lets the create path read the order back inside its transaction. */
  findByUid(uid: string, client: { ne26Order: PrismaClient["ne26Order"] } = this.prismaClient) {
    return client.ne26Order.findUnique({
      where: { uid },
      select: {
        uid: true,
        status: true,
        bookerUserId: true,
        bookerEmail: true,
        bookerName: true,
        bookerCountry: true,
        bookerVatNumber: true,
        bookerLegalName: true,
        bookerAddressLine1: true,
        bookerAddressLine2: true,
        bookerPostalCode: true,
        bookerCity: true,
        bookerPoNumber: true,
        bookerInternalReference: true,
        amountTotal: true,
        currency: true,
        holdExpiresAt: true,
        stripePaymentId: true,
        paidAt: true,
        invoiceNumber: true,
        invoicePdfUrl: true,
        creditNoteNumber: true,
        creditNotePdfUrl: true,
        roomVatRate: true,
        vatZeroRated: true,
        vatMention: true,
        createdAt: true,
        bookings: {
          orderBy: { startTime: "asc" },
          select: {
            uid: true,
            startTime: true,
            endTime: true,
            durationMinutes: true,
            amountTotal: true,
            resource: { select: { name: true, slug: true, category: true } },
            addOns: {
              select: { quantity: true, lineTotal: true, vatRate: true, addOn: { select: { name: true } } },
            },
          },
        },
      },
    });
  }

  /** Resolve an order from the Stripe payment that settled it. */
  findByStripePaymentId(stripePaymentId: string) {
    return this.prismaClient.ne26Order.findUnique({
      where: { stripePaymentId },
      select: { uid: true, status: true, invoiceNumber: true, creditNoteNumber: true },
    });
  }

  /**
   * Flip a held order and all its rooms to CONFIRMED.
   *
   * Scoped to PENDING so a replayed webhook is a no-op rather than a second
   * confirmation, and returns whether anything changed so the caller can tell
   * "just confirmed" from "already handled".
   */
  async confirmPaid(uid: string, stripePaymentId: string | null): Promise<boolean> {
    return this.prismaClient.$transaction(async (tx) => {
      const result = await tx.ne26Order.updateMany({
        where: { uid, status: ResourceBookingStatus.PENDING },
        data: {
          status: ResourceBookingStatus.CONFIRMED,
          stripePaymentId,
          paidAt: new Date(),
          holdExpiresAt: null,
        },
      });
      if (result.count === 0) return false;
      // The payment id is deliberately NOT copied onto the rooms: it is unique
      // per booking row, so one payment covering three rooms would violate the
      // constraint and the whole confirmation would roll back — a paid order
      // left PENDING. The payment belongs to the order, which is where it is
      // stored and where the refund path resolves it from.
      await tx.resourceBooking.updateMany({
        where: { orderUid: uid, status: ResourceBookingStatus.PENDING },
        data: { status: ResourceBookingStatus.CONFIRMED, holdExpiresAt: null },
      });
      return true;
    });
  }

  /**
   * Release a held order: the rooms go back on sale immediately.
   *
   * A delete rather than a status change, so the slot rows go with it — a
   * CANCELLED row keeping its slots would leave the rooms unsellable. Scoped to
   * PENDING, so it can never touch something already paid for.
   */
  async cancelPending(uid: string): Promise<boolean> {
    const result = await this.prismaClient.ne26Order.deleteMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
    });
    return result.count > 0;
  }

  /** Billing confirmed at Checkout. Only ever upgrades what we already know. */
  async applyCheckoutBilling(
    uid: string,
    data: {
      country?: string | null;
      vatNumber?: string | null;
      name?: string | null;
      legalName?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      postalCode?: string | null;
      city?: string | null;
    }
  ): Promise<void> {
    await this.prismaClient.ne26Order.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      // A blank field from Checkout must never overwrite what the billing
      // profile already told us: it would change the VAT on the invoice.
      data: {
        ...(data.country?.trim() ? { bookerCountry: data.country } : {}),
        ...(data.vatNumber?.trim() ? { bookerVatNumber: data.vatNumber } : {}),
        ...(data.name?.trim() ? { bookerName: data.name } : {}),
        ...(data.legalName?.trim() ? { bookerLegalName: data.legalName } : {}),
        ...(data.addressLine1?.trim() ? { bookerAddressLine1: data.addressLine1 } : {}),
        ...(data.addressLine2?.trim() ? { bookerAddressLine2: data.addressLine2 } : {}),
        ...(data.postalCode?.trim() ? { bookerPostalCode: data.postalCode } : {}),
        ...(data.city?.trim() ? { bookerCity: data.city } : {}),
      },
    });
  }

  async setInvoice(
    uid: string,
    invoiceNumber: string,
    invoicePdfUrl: string,
    vat: { roomVatRate: number; zeroRated: boolean; mention: string | null }
  ): Promise<void> {
    await this.prismaClient.ne26Order.update({
      where: { uid },
      data: {
        invoiceNumber,
        invoicePdfUrl,
        roomVatRate: vat.roomVatRate,
        vatZeroRated: vat.zeroRated,
        vatMention: vat.mention,
      },
    });
  }

  /**
   * Credit an order and put its rooms back on sale, atomically.
   *
   * The number is claimed in the same statement that cancels the order, so two
   * refund webhooks arriving together cannot both proceed: the second updates
   * nothing and returns 0. The bookings are deleted rather than marked
   * cancelled — a CANCELLED row keeping its slot rows would leave the rooms
   * unsellable for the rest of the event.
   */
  async creditNoteAndCancel(
    uid: string,
    creditNoteNumber: string,
    creditNotePdfUrl: string
  ): Promise<number> {
    return this.prismaClient.$transaction(async (tx) => {
      const result = await tx.ne26Order.updateMany({
        where: {
          uid,
          status: ResourceBookingStatus.CONFIRMED,
          invoiceNumber: { not: null },
          creditNoteNumber: null,
        },
        data: { creditNoteNumber, creditNotePdfUrl, status: ResourceBookingStatus.CANCELLED },
      });
      if (result.count === 0) return 0;
      await tx.resourceBooking.deleteMany({ where: { orderUid: uid } });
      return result.count;
    });
  }

  /**
   * When this exhibitor already has a room, so a second one that day can be
   * refused before any money moves.
   *
   * Confirmed bookings and live holds both count: a hold takes the room off sale,
   * so letting someone hold three days' worth and pay for one would be exactly
   * the loophole the rule exists to close. Expired holds do not count — they
   * protect nothing.
   */
  async findBookedStartsForUser(
    booker: { userId: number | null; email: string },
    now: Date
  ): Promise<Date[]> {
    // Matched on the account when there is one, and on the email otherwise: the
    // rule is one room per EXHIBITOR, and a walk-in sold two rooms on the same
    // day at the counter breaks it just as surely as an account holder would.
    // The email is what the desk collects, so it is what identifies them.
    const identity = booker.userId
      ? { bookerUserId: booker.userId }
      : { bookerUserId: null, bookerEmail: booker.email };
    const rows = await this.prismaClient.resourceBooking.findMany({
      where: {
        ...identity,
        isBlock: false,
        OR: [
          { status: ResourceBookingStatus.CONFIRMED },
          { status: ResourceBookingStatus.PENDING, holdExpiresAt: { gt: now } },
        ],
      },
      select: { startTime: true },
    });
    return rows.map((r) => r.startTime);
  }

  /**
   * Held orders whose time is nearly up and who have not been warned yet.
   *
   * Bounded by `from` as well as `before`: an order whose hold already lapsed is
   * past saving, and mailing "10 minutes left" about a room that is back on sale
   * would be worse than saying nothing.
   */
  findHoldsExpiringSoon(from: Date, before: Date) {
    return this.prismaClient.ne26Order.findMany({
      where: {
        status: ResourceBookingStatus.PENDING,
        holdReminderSentAt: null,
        holdExpiresAt: { gt: from, lte: before },
      },
      select: {
        uid: true,
        bookerName: true,
        bookerEmail: true,
        holdExpiresAt: true,
        bookings: {
          orderBy: { startTime: "asc" },
          select: { startTime: true, endTime: true, resource: { select: { name: true } } },
        },
      },
    });
  }

  /**
   * Claim the reminder for one order, returning whether this caller won it.
   *
   * Scoped to holdReminderSentAt still being null, so two overlapping cron runs
   * cannot both send: the second updates nothing and is told so.
   */
  async claimHoldReminder(uid: string, at: Date): Promise<boolean> {
    const result = await this.prismaClient.ne26Order.updateMany({
      where: { uid, holdReminderSentAt: null, status: ResourceBookingStatus.PENDING },
      data: { holdReminderSentAt: at },
    });
    return result.count > 0;
  }

  /**
   * Orders with no rooms attached — money with nothing to show for it.
   *
   * A payment that was captured but never confirmed leaves its rooms PENDING;
   * once the hold lapses they are deleted, and because the admin lists ROOMS the
   * order itself becomes invisible. It still exists, and it may be paid. These
   * are surfaced at the top of the dashboard rather than left to be found by
   * someone querying the database.
   */
  findOrdersWithoutRooms() {
    return this.prismaClient.ne26Order.findMany({
      where: { bookings: { none: {} } },
      orderBy: { createdAt: "desc" },
      select: {
        uid: true,
        status: true,
        bookerName: true,
        bookerEmail: true,
        amountTotal: true,
        currency: true,
        stripePaymentId: true,
        invoiceNumber: true,
        holdExpiresAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * The one order this buyer is holding right now, newest first.
   *
   * There can be up to three; the panel shows the one about to lapse, which is
   * the one worth a countdown.
   */
  findLiveHoldForUser(bookerUserId: number, now: Date) {
    return this.prismaClient.ne26Order.findFirst({
      where: {
        bookerUserId,
        status: ResourceBookingStatus.PENDING,
        holdExpiresAt: { gt: now },
      },
      orderBy: { holdExpiresAt: "asc" },
      select: {
        uid: true,
        holdExpiresAt: true,
        amountTotal: true,
        currency: true,
        _count: { select: { bookings: true } },
      },
    });
  }

  /** How many orders this buyer is holding without having paid. */
  countActiveHolds(bookerUserId: number | null, now: Date): Promise<number> {
    return this.prismaClient.ne26Order.count({
      where: { bookerUserId, status: ResourceBookingStatus.PENDING, holdExpiresAt: { gt: now } },
    });
  }
}
