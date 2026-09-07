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
  /**
   * Decides, INSIDE the create transaction and under this buyer's lock, which
   * of their live holds this order replaces — and refuses the order outright
   * if the commercial rules say it may not exist.
   *
   * It runs here rather than before the transaction because a rule that is
   * read outside the write it protects is not enforced at all: two baskets
   * arriving together both read "no conflict" and both committed, and one
   * exhibitor ended up holding two rooms on the same day.
   *
   * The uids it returns are released before any slot is written: an exhibitor
   * editing the basket they hold asks for the SAME room at the SAME slot, so
   * the old rows must go first — and if the write then fails, the rollback
   * gives them their hold back.
   */
  planUnderLock?: (tx: TransactionClient) => Promise<string[]>;
}

/** The subset of the client available inside `$transaction`. */
export type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Thrown inside a transaction purely to roll it back, and never escapes.
 *
 * Both confirming and extending an order have to be all-or-nothing: writing the
 * order row and finding no rooms to write beside it is not a partial success,
 * it is a state we must refuse to record.
 */
class NoRoomsToConfirm extends Error {}

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
        // One exhibitor's orders are created one at a time. The slot index
        // already stops two people taking one room; this stops one person
        // taking two rooms on one day by sending both baskets at once. Keyed
        // on the buyer, so it never delays anybody else, and released when the
        // transaction ends whichever way it goes.
        const lockKey = `ne26:buyer:${input.bookerUserId ?? input.bookerEmail.toLowerCase()}`;
        // $executeRaw, not $queryRaw: the lock function returns void, which
        // Prisma cannot deserialise as a result column.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const supersedeOrderUids = input.planUnderLock ? await input.planUnderLock(tx) : [];

        // Scoped to PENDING and to this same buyer whatever the caller passed:
        // a uid is not a permission, and releasing somebody else's hold — or a
        // paid order — would sell a room out from under them.
        if (supersedeOrderUids.length) {
          await tx.ne26Order.deleteMany({
            where: {
              uid: { in: supersedeOrderUids },
              status: ResourceBookingStatus.PENDING,
              ...(input.bookerUserId === null
                ? { bookerUserId: null, bookerEmail: input.bookerEmail }
                : { bookerUserId: input.bookerUserId }),
            },
          });
        }

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
        stripeSessionId: true,
        paymentFailedNotifiedAt: true,
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
    try {
      return await this.confirmPaidOrThrow(uid, stripePaymentId);
    } catch (e) {
      if (e instanceof NoRoomsToConfirm) return false;
      throw e;
    }
  }

  private confirmPaidOrThrow(uid: string, stripePaymentId: string | null): Promise<boolean> {
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
      const rooms = await tx.resourceBooking.updateMany({
        where: { orderUid: uid, status: ResourceBookingStatus.PENDING },
        data: { status: ResourceBookingStatus.CONFIRMED, holdExpiresAt: null },
      });
      // No rooms left to confirm. Success was decided on the order row alone,
      // so a payment landing after the rooms had been reclaimed was recorded
      // as a sale: order CONFIRMED, nothing booked, an invoice rendered at
      // zero, and no alert because the order itself existed. Rolling back
      // leaves the order PENDING and returns false, which is what makes the
      // caller raise the "money captured, nothing held" alarm.
      if (rooms.count === 0) throw new NoRoomsToConfirm();
      return true;
    });
  }

  /**
   * Push a live hold further out, never nearer.
   *
   * Both the order AND its rooms: the reclaim path frees slots by looking at
   * the BOOKING's holdExpiresAt, so extending only the order would leave the
   * rooms collectable while the order still believed it held them.
   *
   * `lt: until` makes this monotonic — a concurrent call can only ever move the
   * expiry forward, never cut a hold short.
   */
  async extendHold(uid: string, until: Date, now: Date = new Date()): Promise<boolean> {
    try {
      return await this.extendHoldOrThrow(uid, until, now);
    } catch (e) {
      if (e instanceof NoRoomsToConfirm) return false;
      throw e;
    }
  }

  private extendHoldOrThrow(uid: string, until: Date, now: Date): Promise<boolean> {
    return this.prismaClient.$transaction(async (tx) => {
      // `gt: now` is the difference between extending a hold and resurrecting
      // one. Without it, a lapsed order whose rooms had already been resold
      // came back as a live hold owning nothing — and could then be paid for.
      const result = await tx.ne26Order.updateMany({
        where: {
          uid,
          status: ResourceBookingStatus.PENDING,
          holdExpiresAt: { gt: now, lt: until },
        },
        data: { holdExpiresAt: until },
      });
      if (result.count === 0) return false;
      const rooms = await tx.resourceBooking.updateMany({
        where: { orderUid: uid, status: ResourceBookingStatus.PENDING },
        data: { holdExpiresAt: until },
      });
      // An order still inside its window but holding nothing has already lost
      // its rooms to the reclaim path. Extending it would only prolong the
      // fiction; the buyer must be told to book again.
      if (rooms.count === 0) throw new NoRoomsToConfirm();
      return true;
    });
  }

  /**
   * Claim the right to tell the team that a payment attempt on this order
   * failed. True once per order, false ever after.
   *
   * Stripe raises payment_intent.payment_failed on every declined attempt, and
   * a buyer working through three cards would otherwise send the desk three
   * identical follow-ups for one problem.
   */
  async claimPaymentFailedNotice(uid: string, at: Date): Promise<boolean> {
    const result = await this.prismaClient.ne26Order.updateMany({
      where: { uid, paymentFailedNotifiedAt: null },
      data: { paymentFailedNotifiedAt: at },
    });
    return result.count > 0;
  }

  /** Remember which Checkout session is open, so it can be expired later. */
  async setStripeSessionId(uid: string, sessionId: string | null): Promise<void> {
    await this.prismaClient.ne26Order.updateMany({
      where: { uid, status: ResourceBookingStatus.PENDING },
      data: { stripeSessionId: sessionId },
    });
  }

  /**
   * Every order that has a document, for the accounting bundle.
   *
   * Ordered by number rather than by date so the archive reads like the ledger
   * it will be filed against.
   */
  findIssuedDocuments() {
    return this.prismaClient.ne26Order.findMany({
      where: { OR: [{ invoiceNumber: { not: null } }, { creditNoteNumber: { not: null } }] },
      select: {
        uid: true,
        invoiceNumber: true,
        creditNoteNumber: true,
        bookerName: true,
        bookerLegalName: true,
      },
      orderBy: { invoiceNumber: "asc" },
    });
  }

  /**
   * Documents issued before orders existed, which hang off the booking itself.
   *
   * Four of the first six invoices are these. An accounting bundle built from
   * orders alone hands over a third of the file and says nothing about the
   * rest — the worst kind of incomplete, because it looks complete.
   *
   * Their PDFs are stored under the BOOKING uid, which is why the caller has
   * to keep them apart from the order-backed ones.
   */
  findLegacyIssuedDocuments() {
    return this.prismaClient.resourceBooking.findMany({
      where: {
        orderUid: null,
        OR: [{ invoiceNumber: { not: null } }, { creditNoteNumber: { not: null } }],
      },
      select: {
        uid: true,
        invoiceNumber: true,
        creditNoteNumber: true,
        bookerName: true,
      },
      orderBy: { invoiceNumber: "asc" },
    });
  }

  /** Open Checkout sessions for these orders, read BEFORE the orders are deleted. */
  async findStripeSessionIds(
    uids: string[],
    client: { ne26Order: PrismaClient["ne26Order"] } = this.prismaClient
  ): Promise<string[]> {
    if (uids.length === 0) return [];
    const rows = await client.ne26Order.findMany({
      where: { uid: { in: uids }, stripeSessionId: { not: null } },
      select: { stripeSessionId: true },
    });
    return rows.map((r) => r.stripeSessionId as string);
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
    await this.prismaClient.$transaction(async (tx) => {
      // The address block on the invoice: what the buyer confirmed at payment
      // beats what they saved months earlier, and a blank field never wins.
      // None of these change a single amount.
      await tx.ne26Order.updateMany({
        where: { uid, status: ResourceBookingStatus.PENDING },
        data: {
          ...(data.name?.trim() ? { bookerName: data.name } : {}),
          ...(data.legalName?.trim() ? { bookerLegalName: data.legalName } : {}),
          ...(data.addressLine1?.trim() ? { bookerAddressLine1: data.addressLine1 } : {}),
          ...(data.addressLine2?.trim() ? { bookerAddressLine2: data.addressLine2 } : {}),
          ...(data.postalCode?.trim() ? { bookerPostalCode: data.postalCode } : {}),
          ...(data.city?.trim() ? { bookerCity: data.city } : {}),
        },
      });

      // The country and the VAT number are different in kind: they decided the
      // VAT, and the VAT decided the amount already charged to the card. They
      // are filled ONLY when the order has none — a counter sale, where the
      // desk collected nothing and Checkout is the only source there will ever
      // be. Overwriting them meant an exhibitor could be charged 21% and
      // invoiced zero-rated, because the price was computed from the profile
      // and the document from whatever Stripe returned.
      //
      // A buyer whose card sits in another country is not re-rated here. If the
      // country really was wrong, the answer is a credit note and a fresh
      // invoice, not a silent re-rating of a payment already taken.
      const missing = { OR: [{ bookerCountry: null }, { bookerCountry: "" }] };
      if (data.country?.trim()) {
        await tx.ne26Order.updateMany({
          where: { uid, status: ResourceBookingStatus.PENDING, ...missing },
          data: { bookerCountry: data.country },
        });
      }
      if (data.vatNumber?.trim()) {
        await tx.ne26Order.updateMany({
          where: {
            uid,
            status: ResourceBookingStatus.PENDING,
            OR: [{ bookerVatNumber: null }, { bookerVatNumber: "" }],
          },
          data: { bookerVatNumber: data.vatNumber },
        });
      }
    });
  }

  async setInvoice(
    uid: string,
    invoiceNumber: string,
    invoicePdfUrl: string,
    vat: { roomVatRate: number; zeroRated: boolean; mention: string | null },
    client: { ne26Order: PrismaClient["ne26Order"] } = this.prismaClient
  ): Promise<void> {
    await client.ne26Order.update({
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
   * Hand out the next document number and do the work that uses it, together.
   *
   * The number came from a Postgres sequence, and nextval cannot be rolled
   * back: it is consumed even when the transaction that asked for it fails. So
   * every failed PDF render tore a permanent hole in a series that is supposed
   * to be unbroken, and the only remedy was to explain the hole to an
   * accountant afterwards.
   *
   * A counter row is incremented inside the same transaction that renders and
   * records the document. If anything in `work` throws, the increment goes back
   * with it and the number is handed to the next document instead. The row lock
   * also serialises issuance — at a few hundred documents over three days that
   * costs nothing, and it is what makes the series safe under a replayed
   * webhook arriving beside a manual one.
   *
   * The timeout is generous because rendering a PDF happens inside.
   */
  async issueWithNumber<T>(
    series: "invoice" | "credit-note",
    year: number,
    work: (documentNumber: string, tx: TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.prismaClient.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
          INSERT INTO "Ne26DocumentCounter" ("series", "lastNumber", "updatedAt")
          VALUES (${series}, 1, CURRENT_TIMESTAMP)
          ON CONFLICT ("series") DO UPDATE
            SET "lastNumber" = "Ne26DocumentCounter"."lastNumber" + 1,
                "updatedAt" = CURRENT_TIMESTAMP
          RETURNING "lastNumber"`;
        const next = rows[0].lastNumber;
        // The two series have different shapes and always have had:
        // NE26-2026-0007 for an invoice, NE26-CN-2026-0007 for a credit note.
        // They are unique columns, so getting this wrong collides with a
        // document that already exists.
        const prefix = series === "credit-note" ? `NE26-CN-${year}` : `NE26-${year}`;
        return work(`${prefix}-${String(next).padStart(4, "0")}`, tx);
      },
      { timeout: 60_000, maxWait: 20_000 }
    );
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
    creditNotePdfUrl: string,
    // Supplied when this runs inside issueWithNumber's transaction, so the
    // number, the cancellation and the freed rooms commit or fail together.
    // Prisma has no nested interactive transactions, so it must be passed in
    // rather than opened again here.
    outer?: TransactionClient
  ): Promise<number> {
    const run = async (tx: TransactionClient) => {
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
    };
    return outer ? run(outer) : this.prismaClient.$transaction(run);
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
  async findOccupiedDaysForUser(
    booker: { userId: number | null; email: string },
    now: Date,
    client: { resourceBooking: PrismaClient["resourceBooking"] } = this.prismaClient
  ): Promise<{ startTime: Date; orderUid: string | null; paid: boolean }[]> {
    // One EXHIBITOR, however they reached us. Matching the account when there
    // was one and the email otherwise made those two sets disjoint: the same
    // person could take a room from their phone AND buy a second at the
    // counter on the same day, because neither query could see the other. The
    // email is what identifies an exhibitor, and the account is an additional
    // way of finding them, so both are searched.
    //
    // Both clauses go under AND, and that is not a stylistic choice: two `OR`
    // keys in one filter object are the same key twice, so the second silently
    // replaced the first. The identity clause was the one that lost, and the
    // query returned EVERY exhibitor's bookings — one booking closed that day
    // to all nine rooms and every other exhibitor.
    const identity = booker.userId
      ? { OR: [{ bookerUserId: booker.userId }, { bookerEmail: booker.email }] }
      : { bookerEmail: booker.email };
    const rows = await client.resourceBooking.findMany({
      where: {
        isBlock: false,
        AND: [
          identity,
          {
            OR: [
              { status: ResourceBookingStatus.CONFIRMED },
              { status: ResourceBookingStatus.PENDING, holdExpiresAt: { gt: now } },
            ],
          },
        ],
      },
      select: { startTime: true, orderUid: true, status: true },
    });
    // Which order a day belongs to, and whether it is paid for. A CONFIRMED
    // booking is a room the exhibitor owns and nothing may displace it; a
    // PENDING one is their own basket, taken off sale, which a new order of
    // theirs is entitled to replace.
    return rows.map((r) => ({
      startTime: r.startTime,
      orderUid: r.orderUid,
      paid: r.status === ResourceBookingStatus.CONFIRMED,
    }));
  }

  /**
   * The exhibitor gives up a hold of their own.
   *
   * The admin has been able to cancel a pending order since the beginning; the
   * buyer holding the room could not, and was told to "cancel the one you have"
   * with nothing to cancel it with. Scoped to the account so a uid seen in a
   * URL cannot release a stranger's rooms.
   */
  async releaseOwnHold(uid: string, bookerUserId: number): Promise<boolean> {
    const result = await this.prismaClient.ne26Order.deleteMany({
      where: { uid, bookerUserId, status: ResourceBookingStatus.PENDING },
    });
    return result.count > 0;
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
   *
   * CANCELLED is excluded, and that exclusion is the whole difference between a
   * panel worth reading and one nobody reads. Issuing a credit note deletes the
   * order's rooms (creditNoteAndCancel) — so every properly refunded order left
   * this query holding no rooms and carrying a Stripe payment id, and was
   * announced in red as "paid but holds no room, reconcile or refund in
   * Stripe". Business already finished. Over a three-day event the alarm that
   * exists to catch the one real disaster would have filled with resolved
   * refunds long before the disaster arrived.
   */
  findOrdersWithoutRooms() {
    return this.prismaClient.ne26Order.findMany({
      where: { bookings: { none: {} }, status: { not: ResourceBookingStatus.CANCELLED } },
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
   * One order, whatever state it is in — including holding no rooms at all.
   *
   * findByUid is reached through a room in the admin, which is exactly the path
   * that does not exist for an order whose rooms are gone: the case someone
   * most needs to open.
   */
  findForAdmin(uid: string) {
    return this.prismaClient.ne26Order.findUnique({
      where: { uid },
      include: {
        bookings: {
          include: { resource: { select: { name: true } } },
          orderBy: { startTime: "asc" },
        },
      },
    });
  }

  /**
   * Close an order that holds nothing, once a human has settled it elsewhere.
   *
   * The one case that reaches this: money was captured, the confirmation never
   * ran, and the hold lapsed — so the rooms went back on sale and may already
   * belong to somebody else. The app must not re-book them and must not invoice
   * them, and it deliberately does neither. What it can do is stop being a dead
   * end: after the refund is made in Stripe, this marks the order settled so the
   * alert clears.
   *
   * CANCELLED rather than deleted, on purpose. cancelPending deletes, which is
   * right for an abandoned checkout that took no money and wrong for one that
   * did: the Stripe payment id and the amount are the reconciliation trail and
   * they stay on the row.
   *
   * Written as one statement with a NOT EXISTS guard rather than a read followed
   * by a write. Reading "it has no rooms" and then cancelling leaves a window in
   * which a room could be attached, and this must never be able to cancel an
   * order that is holding one.
   */
  async closeSettledOrder(uid: string): Promise<boolean> {
    const count = await this.prismaClient.$executeRaw`
      UPDATE "Ne26Order"
      SET "status" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "uid" = ${uid}
        AND "status" = 'PENDING'
        AND NOT EXISTS (SELECT 1 FROM "ResourceBooking" b WHERE b."orderUid" = "Ne26Order"."uid")`;
    return count > 0;
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
  countActiveHolds(
    booker: { userId: number | null; email: string },
    now: Date,
    client: { ne26Order: PrismaClient["ne26Order"] } = this.prismaClient
  ): Promise<number> {
    // Counted per exhibitor, account or counter, for the same reason the day
    // rule is: an account holder who also buys at the desk was getting two
    // separate budgets of unpaid holds.
    //
    // The counter previously shared ONE pool of holds between every walk-in,
    // so six abandoned checkouts by six different people stopped the desk
    // selling to a seventh. A cap is meant to stop one buyer parking
    // inventory, not to stop the queue moving.
    return client.ne26Order.count({
      where: {
        ...(booker.userId
          ? { OR: [{ bookerUserId: booker.userId }, { bookerEmail: booker.email }] }
          : { bookerEmail: booker.email }),
        status: ResourceBookingStatus.PENDING,
        holdExpiresAt: { gt: now },
      },
    });
  }
}
