import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { PDFDocument } from "pdf-lib";
import { buildOrderIcs } from "../lib/ics";
import { buildInvoiceModel, ROOM_VAT_RATE_BP } from "../lib/invoice";
import type { InvoiceMeta } from "../lib/invoicePdf";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { readCreditNotePdf, readInvoicePdf, saveCreditNotePdf, saveInvoicePdf } from "../lib/invoiceStorage";
import {
  type BillingCorrection,
  correctionColumns,
  describeCorrection,
  resolveBillTo,
} from "../lib/billingCorrection";
import { sendInvoiceEmail } from "../lib/mailer";
import { formatSlotRange } from "../lib/teamNotification";
import { resolveVatTreatment } from "../lib/vat";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import { orderRef } from "../lib/orderRef";
import type { Ne26BillingProfileRepository } from "../repositories/Ne26BillingProfileRepository";
import type { Ne26OrderRepository } from "../repositories/Ne26OrderRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";

/**
 * Thrown to roll the credit-note transaction back when the order turns out to
 * have been credited already — a second refund webhook, or an admin who
 * clicked twice. It never escapes the service.
 */
class AlreadyCredited extends Error {}

export interface IInvoiceServiceDeps {
  ne26OrderRepository: Ne26OrderRepository;
  /** Only for the invoice / credit-note number sequences. */
  resourceBookingRepository: ResourceBookingRepository;
  invoiceSettingsRepository: InvoiceSettingsRepository;
  ne26BillingProfileRepository: Ne26BillingProfileRepository;
}

type Order = NonNullable<Awaited<ReturnType<Ne26OrderRepository["findByUid"]>>>;
type OrderBooking = Order["bookings"][number];

/**
 * One order, one invoice.
 *
 * An exhibitor who books three rooms pays once and receives one document
 * listing all three — the same way a room and its add-ons have always shared an
 * invoice. Numbering, VAT freezing and crediting therefore all happen at the
 * order, never per room.
 */
export class InvoiceService {
  constructor(private deps: IInvoiceServiceDeps) {}

  /**
   * The invoice "Bill to".
   *
   * What the buyer confirmed at Checkout wins over the saved profile: a counter
   * sale has no profile at all, and on a web order the address typed at payment
   * is more current than one saved months earlier.
   */
  private async resolveBillTo(order: Order): Promise<NonNullable<InvoiceMeta["billTo"]>> {
    const profile = order.bookerUserId
      ? await this.deps.ne26BillingProfileRepository.findByUserId(order.bookerUserId)
      : null;
    return resolveBillTo(order, profile);
  }

  /**
   * Everything printed on an invoice or a credit note besides its lines. One
   * builder for issuing and for re-rendering after a billing correction, so a
   * corrected document differs from the original in its "Bill to" and nowhere
   * else.
   */
  private documentMeta(
    order: Order,
    kind: "invoice" | "credit_note",
    number: string,
    issueDate: Date,
    billTo: NonNullable<InvoiceMeta["billTo"]>,
    /** The rooms this document is about: a credit note may cover only some. */
    bookings: OrderBooking[] = order.bookings
  ): InvoiceMeta {
    const first = bookings[0];
    return {
      invoiceNumber: number,
      ...(kind === "credit_note"
        ? { kind: "credit_note" as const, relatedInvoiceNumber: order.invoiceNumber ?? undefined }
        : // An order with no Stripe payment id was settled offline (bank transfer).
          { paidViaStripe: Boolean(order.stripePaymentId) }),
      issueDate,
      bookerName: order.bookerName,
      bookerEmail: order.bookerEmail,
      orderRef: orderRef(order.orderNumber),
      poNumber: order.bookerPoNumber,
      internalReference: order.bookerInternalReference,
      billTo,
      roomName: this.roomLabel(order, bookings),
      startUtc: first?.startTime ?? issueDate,
      endUtc: first?.endTime ?? issueDate,
    };
  }

  private invoiceRooms(order: Order, bookings: OrderBooking[] = order.bookings) {
    return bookings.map((b) => ({
      amountTotal: b.amountTotal,
      roomName: b.resource.name,
      durationMinutes: b.durationMinutes,
      slotLabel: formatSlotRange(b.startTime, b.endTime),
      addOns: b.addOns.map((a) => ({
        name: a.addOn.name,
        quantity: a.quantity,
        lineTotal: a.lineTotal,
        vatRate: a.vatRate,
      })),
    }));
  }

  /**
   * Every room and every add-on, for the confirmation email's body.
   *
   * The subject still names one room and counts the rest — a subject line has
   * no space — but the body must be exhaustive: an exhibitor who booked three
   * rooms with catering should not have to open the PDF to check what went
   * through.
   */
  private emailRooms(order: Order, bookings: OrderBooking[] = order.bookings) {
    const label = (cents: number) => `${(cents / 100).toFixed(2)} ${order.currency}`;
    return bookings.map((b) => ({
      roomName: b.resource.name,
      slotLabel: formatSlotRange(b.startTime, b.endTime),
      durationMinutes: b.durationMinutes,
      amountLabel: label(b.amountTotal),
      addOns: b.addOns.map((a) => ({
        name: a.addOn.name,
        quantity: a.quantity,
        lineLabel: label(a.lineTotal),
      })),
    }));
  }

  /** "Suite 1" for one room, "Suite 1 + 2 more" beyond — for email subjects. */
  private roomLabel(order: Order, bookings: OrderBooking[] = order.bookings): string {
    const [first, ...rest] = bookings;
    if (!first) return "NATO Edge 26";
    return rest.length === 0 ? first.resource.name : `${first.resource.name} + ${rest.length} more`;
  }

  /**
   * Issue the invoice for a paid order: allocate a sequential number, render the
   * PDF, store it, persist the number, then email it with the calendar invites.
   * Idempotent: a no-op if the order is missing, not CONFIRMED, or already
   * invoiced — which is what makes a replayed webhook harmless.
   *
   * Also a no-op for an order holding no rooms. confirmPaid already refuses to
   * record a sale with nothing in it, and this is the same refusal one step
   * later: an invoice listing no rooms would still take its number from a
   * gapless series and still be emailed to the buyer. The admin screens hide
   * the button for that case, but a screen is not a boundary — the procedure
   * behind it accepts any uid an admin sends, and the button that reaches it
   * exists to repair orders that are already broken.
   */
  async issueInvoice(uid: string): Promise<void> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order || order.status !== ResourceBookingStatus.CONFIRMED || order.invoiceNumber) return;
    if (order.bookings.length === 0) return;

    const issuer = await this.deps.invoiceSettingsRepository.get();
    const vat = resolveVatTreatment(
      { country: order.bookerCountry, vatNumber: order.bookerVatNumber },
      issuer
    );
    // The rate in force for this order; frozen onto the order below.
    const roomVatRate = ROOM_VAT_RATE_BP;
    const model = buildInvoiceModel(
      { currency: order.currency, roomVatRate, rooms: this.invoiceRooms(order) },
      vat
    );

    // Year comes from the issue date, not a literal: a document raised in
    // January 2027 was being stamped 2026.
    const issueDate = new Date();
    const billTo = await this.resolveBillTo(order);

    // The number, the PDF and the record of it are one operation. Drawn from a
    // sequence beforehand, a number was spent whether or not a document ever
    // carried it, and a failed render left a permanent hole in the series.
    const { invoiceNumber, pdf } = await this.deps.ne26OrderRepository.issueWithNumber(
      "invoice",
      issueDate.getUTCFullYear(),
      async (invoiceNumber, tx) => {
        const pdf = await renderInvoicePdf(
          model,
          this.documentMeta(order, "invoice", invoiceNumber, issueDate, billTo),
          issuer
        );

        await saveInvoicePdf(uid, pdf);
        // Recorded inside the same transaction as the number, so the two can
        // never disagree. A failed email afterwards is logged by the caller and
        // resent from the stored PDF — never re-issued, which would spend a
        // second number.
        await this.deps.ne26OrderRepository.setInvoice(
          uid,
          invoiceNumber,
          `/rooms/invoice/${uid}`,
          { roomVatRate, zeroRated: vat.zeroRated, mention: vat.mention },
          tx,
          issueDate
        );
        return { invoiceNumber, pdf };
      }
    );

    await sendInvoiceEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName,
      orderRef: orderRef(order.orderNumber),
      invoiceNumber,
      roomName: this.roomLabel(order),
      rooms: this.emailRooms(order),
      amountLabel: `${(model.totalTtc / 100).toFixed(2)} ${order.currency}`,
      pdf,
      // One calendar file holding every room: an exhibitor who booked three
      // should press "add to calendar" once.
      ics: buildOrderIcs(
        order.bookings.map((b) => ({
          uid: b.uid,
          roomName: b.resource.name,
          startUtc: b.startTime,
          endUtc: b.endTime,
        }))
      ),
    });
  }

  /**
   * Re-send an already-issued invoice (admin action, e.g. the buyer lost it).
   * Reads the stored PDF; never re-issues, so the number never changes.
   */
  async resendInvoice(uid: string): Promise<boolean> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order?.invoiceNumber) return false;
    const pdf = await readInvoicePdf(uid, "invoice");
    if (!pdf) return false;
    await sendInvoiceEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName,
      orderRef: orderRef(order.orderNumber),
      invoiceNumber: order.invoiceNumber,
      roomName: this.roomLabel(order),
      rooms: this.emailRooms(order),
      amountLabel: `${(order.amountTotal / 100).toFixed(2)} ${order.currency}`,
      pdf,
    });
    return true;
  }

  /**
   * Credit an order's rooms — all of them, or just the ones named.
   *
   * A payment can cover three rooms and an exhibitor may cancel one, so the
   * credit note belongs to the rooms it cancels. Crediting the last room
   * standing also closes the order, which is why a one-room order produces
   * exactly what it always did: order CANCELLED, number on the order, same link.
   *
   * The VAT is the one FROZEN when the invoice was issued, never recomputed: the
   * invoice PDF is immutable, so a rate corrected since would produce a credit
   * note contradicting the document it credits.
   *
   * Idempotent under concurrency: the rooms are claimed inside the numbering
   * transaction, so a refund webhook and an admin clicking at the same moment
   * produce one note, not two, and the loser spends no number.
   *
   * Returns null when there was nothing to credit.
   */
  async creditBookings(
    uid: string,
    bookingUids?: readonly string[],
    opts: { stripeRefundId?: string | null } = {}
  ): Promise<{ number: string; amountTtc: number; closesOrder: boolean; rooms: string[] } | null> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order || order.status !== ResourceBookingStatus.CONFIRMED || !order.invoiceNumber) return null;

    const creditable = order.bookings.filter(
      (b) => b.status === ResourceBookingStatus.CONFIRMED && b.creditNoteId === null
    );
    const target = bookingUids?.length ? creditable.filter((b) => bookingUids.includes(b.uid)) : creditable;
    // Asked for a room that is not creditable: credit nothing rather than
    // quietly credit the rest, which would refund the wrong amount.
    if (target.length === 0 || (bookingUids?.length && target.length !== bookingUids.length)) return null;

    const issuer = await this.deps.invoiceSettingsRepository.get();
    const vat = { zeroRated: order.vatZeroRated, mention: order.vatMention };
    const model = buildInvoiceModel(
      {
        currency: order.currency,
        roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
        rooms: this.invoiceRooms(order, target),
      },
      vat
    );

    const issueDate = new Date();
    const billTo = await this.resolveBillTo(order);

    const issued = await this.deps.ne26OrderRepository
      .issueWithNumber("credit-note", issueDate.getUTCFullYear(), async (creditNoteNumber, tx) => {
        const applied = await this.deps.ne26OrderRepository.creditBookings(
          uid,
          target.map((b) => b.uid),
          {
            number: creditNoteNumber,
            pdfUrl: `/rooms/credit-note/${creditNoteNumber}`,
            amountHt: model.totalHt,
            amountVat: model.totalVat,
            amountTtc: model.totalTtc,
            currency: order.currency,
            issuedAt: issueDate,
            stripeRefundId: opts.stripeRefundId ?? null,
          },
          tx
        );
        if (!applied) throw new AlreadyCredited();

        const pdf = await renderInvoicePdf(
          model,
          this.documentMeta(order, "credit_note", creditNoteNumber, issueDate, billTo, target),
          issuer
        );
        await saveCreditNotePdf(creditNoteNumber, pdf);
        // The note that closes an order is also stored where the order's own
        // link has always looked, so every credit-note link already emailed
        // keeps resolving.
        if (applied.closesOrder) await saveInvoicePdf(uid, pdf, "credit_note");
        return { creditNoteNumber, pdf, closesOrder: applied.closesOrder };
      })
      .catch((e) => {
        if (e instanceof AlreadyCredited) return null;
        throw e;
      });
    if (!issued) return null;

    await sendInvoiceEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName,
      orderRef: orderRef(order.orderNumber),
      invoiceNumber: issued.creditNoteNumber,
      roomName: this.roomLabel(order, target),
      rooms: this.emailRooms(order, target),
      amountLabel: `${(model.totalTtc / 100).toFixed(2)} ${order.currency}`,
      pdf: issued.pdf,
      documentKind: "credit_note",
    });

    return {
      number: issued.creditNoteNumber,
      amountTtc: model.totalTtc,
      closesOrder: issued.closesOrder,
      rooms: target.map((b) => b.resource.name),
    };
  }

  /**
   * What crediting these rooms would come to, before anything is credited.
   *
   * The refund is sent first and must be for exactly what the credit note will
   * say, so both read the same model: the rooms, their add-ons, and the VAT
   * frozen when the invoice was issued.
   */
  async quoteCredit(
    uid: string,
    bookingUids: readonly string[]
  ): Promise<{ amountHt: number; amountTtc: number } | null> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order) return null;
    const target = order.bookings.filter(
      (b) =>
        bookingUids.includes(b.uid) && b.status === ResourceBookingStatus.CONFIRMED && b.creditNoteId === null
    );
    if (target.length !== bookingUids.length || target.length === 0) return null;
    const model = buildInvoiceModel(
      {
        currency: order.currency,
        roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
        rooms: this.invoiceRooms(order, target),
      },
      { zeroRated: order.vatZeroRated, mention: order.vatMention }
    );
    return { amountHt: model.totalHt, amountTtc: model.totalTtc };
  }

  /**
   * Credit everything still sold on an order — the refund webhook's path, and
   * the admin's "Issue credit note" button. Returns whether one was issued.
   */
  async issueCreditNote(uid: string): Promise<boolean> {
    return (await this.creditBookings(uid)) !== null;
  }

  /**
   * An admin's correction of who an order is billed to: company, contact and
   * address. Nothing else on the order moves.
   *
   * Documents already issued are rendered again under the SAME number, with the
   * SAME issue date, rooms, amounts and the VAT frozen when they were first
   * issued — only the "Bill to" block reads differently. A document not issued
   * yet simply picks the corrected block up when it is.
   *
   * Returns null when there is no such order.
   */
  async correctBilling(
    uid: string,
    input: BillingCorrection
  ): Promise<{ changes: string; regenerated: ("invoice" | "credit_note")[] } | null> {
    const columns = correctionColumns(input);
    const before = await this.deps.ne26OrderRepository.correctBilling(uid, columns);
    if (!before) return null;
    const changes = describeCorrection(before, columns);

    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order) return null;
    const regenerated: ("invoice" | "credit_note")[] = [];
    if (!order.invoiceNumber) return { changes, regenerated };

    const issuer = await this.deps.invoiceSettingsRepository.get();
    const billTo = await this.resolveBillTo(order);
    const model = buildInvoiceModel(
      {
        currency: order.currency,
        roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
        rooms: this.invoiceRooms(order),
      },
      { zeroRated: order.vatZeroRated, mention: order.vatMention }
    );

    if (order.invoiceNumber) {
      const issueDate = order.invoiceIssuedAt ?? (await this.originalIssueDate(order, "invoice"));
      const pdf = await renderInvoicePdf(
        model,
        this.documentMeta(order, "invoice", order.invoiceNumber, issueDate, billTo),
        issuer
      );
      await saveInvoicePdf(uid, pdf, "invoice");
      if (!order.invoiceIssuedAt) {
        await this.deps.ne26OrderRepository.backfillIssuedAt(uid, "invoice", issueDate);
      }
      regenerated.push("invoice");
    }

    // Every credit note raised against this invoice, each with its own rooms and
    // its own amounts: an order credited room by room has more than one, and a
    // correction that rewrote them all from the full order would restate
    // amounts that were never credited.
    const notes = await this.deps.ne26OrderRepository.findCreditNotes(uid);
    const byUid = new Map(order.bookings.map((b) => [b.uid, b]));
    for (const note of notes) {
      const rooms = note.bookings.map((b) => byUid.get(b.uid)).filter((b): b is OrderBooking => Boolean(b));
      if (rooms.length === 0) continue;
      const noteModel = buildInvoiceModel(
        {
          currency: order.currency,
          roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
          rooms: this.invoiceRooms(order, rooms),
        },
        { zeroRated: order.vatZeroRated, mention: order.vatMention }
      );
      const pdf = await renderInvoicePdf(
        noteModel,
        this.documentMeta(order, "credit_note", note.number, note.issuedAt, billTo, rooms),
        issuer
      );
      await saveCreditNotePdf(note.number, pdf);
      if (note.closesOrder) await saveInvoicePdf(uid, pdf, "credit_note");
      regenerated.push("credit_note");
    }
    return { changes, regenerated };
  }

  /**
   * The date a document was first issued, for one issued before that date was
   * recorded: read from the stored PDF, which was created at that moment. The
   * payment date is the last resort — invoices are issued on payment.
   */
  private async originalIssueDate(order: Order, kind: "invoice" | "credit_note"): Promise<Date> {
    const stored = await readInvoicePdf(order.uid, kind);
    if (stored) {
      try {
        const created = (
          await PDFDocument.load(stored.toString("base64"), { updateMetadata: false })
        ).getCreationDate();
        if (created) return created;
      } catch {
        // Unreadable: fall through.
      }
    }
    return order.paidAt ?? order.createdAt;
  }

  /** Credit from a Stripe refund webhook, resolving the order by payment intent. */
  async issueCreditNoteByPaymentIntent(stripePaymentId: string): Promise<boolean> {
    const order = await this.deps.ne26OrderRepository.findByStripePaymentId(stripePaymentId);
    if (!order) return false;
    return this.issueCreditNote(order.uid);
  }
}
