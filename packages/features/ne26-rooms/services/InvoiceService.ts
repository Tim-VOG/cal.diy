import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { buildOrderIcs } from "../lib/ics";
import { buildInvoiceModel, ROOM_VAT_RATE_BP } from "../lib/invoice";
import type { InvoiceMeta } from "../lib/invoicePdf";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { readInvoicePdf, saveInvoicePdf } from "../lib/invoiceStorage";
import { sendInvoiceEmail } from "../lib/mailer";
import { formatSlotRange } from "../lib/teamNotification";
import { resolveVatTreatment } from "../lib/vat";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
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
    return {
      legalName: order.bookerLegalName || profile?.legalName || null,
      addressLine1: order.bookerAddressLine1 || profile?.addressLine1 || null,
      addressLine2: order.bookerAddressLine2 || profile?.addressLine2 || null,
      postalCode: order.bookerPostalCode || profile?.postalCode || null,
      city: order.bookerCity || profile?.city || null,
      country: order.bookerCountry || profile?.country || null,
      vatNumber: order.bookerVatNumber || profile?.vatNumber || null,
    };
  }

  private invoiceRooms(order: Order) {
    return order.bookings.map((b) => ({
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
  private emailRooms(order: Order) {
    const label = (cents: number) => `${(cents / 100).toFixed(2)} ${order.currency}`;
    return order.bookings.map((b) => ({
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
  private roomLabel(order: Order): string {
    const [first, ...rest] = order.bookings;
    if (!first) return "NATO Edge 26";
    return rest.length === 0 ? first.resource.name : `${first.resource.name} + ${rest.length} more`;
  }

  /**
   * Issue the invoice for a paid order: allocate a sequential number, render the
   * PDF, store it, persist the number, then email it with the calendar invites.
   * Idempotent: a no-op if the order is missing, not CONFIRMED, or already
   * invoiced — which is what makes a replayed webhook harmless.
   */
  async issueInvoice(uid: string): Promise<void> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (!order || order.status !== ResourceBookingStatus.CONFIRMED || order.invoiceNumber) return;

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
    const first = order.bookings[0];

    // The number, the PDF and the record of it are one operation. Drawn from a
    // sequence beforehand, a number was spent whether or not a document ever
    // carried it, and a failed render left a permanent hole in the series.
    const { invoiceNumber, pdf } = await this.deps.ne26OrderRepository.issueWithNumber(
      "invoice",
      issueDate.getUTCFullYear(),
      async (invoiceNumber, tx) => {
        const pdf = await renderInvoicePdf(
          model,
          {
            invoiceNumber,
            issueDate,
            // An order with no Stripe payment id was settled offline (bank transfer).
            paidViaStripe: Boolean(order.stripePaymentId),
            bookerName: order.bookerName,
            bookerEmail: order.bookerEmail,
            poNumber: order.bookerPoNumber,
            internalReference: order.bookerInternalReference,
            billTo,
            roomName: this.roomLabel(order),
            startUtc: first?.startTime ?? issueDate,
            endUtc: first?.endTime ?? issueDate,
          },
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
          tx
        );
        return { invoiceNumber, pdf };
      }
    );

    await sendInvoiceEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName,
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
      invoiceNumber: order.invoiceNumber,
      roomName: this.roomLabel(order),
      rooms: this.emailRooms(order),
      amountLabel: `${(order.amountTotal / 100).toFixed(2)} ${order.currency}`,
      pdf,
    });
    return true;
  }

  /**
   * Credit a fully refunded order: allocate a CN number, cancel the order and
   * free every room, render and store the credit note, then email it.
   * Idempotent, and returns whether one was issued.
   */
  async issueCreditNote(uid: string): Promise<boolean> {
    const order = await this.deps.ne26OrderRepository.findByUid(uid);
    if (
      !order ||
      order.status !== ResourceBookingStatus.CONFIRMED ||
      !order.invoiceNumber ||
      order.creditNoteNumber
    ) {
      return false;
    }

    const issuer = await this.deps.invoiceSettingsRepository.get();
    // Re-use the treatment FROZEN when the invoice was issued — never recompute
    // from the live settings. The invoice PDF is stored and immutable, so a rate
    // corrected or a toggle flipped since would produce a credit note that
    // contradicts the document it credits.
    const vat = { zeroRated: order.vatZeroRated, mention: order.vatMention };
    const model = buildInvoiceModel(
      {
        currency: order.currency,
        roomVatRate: order.roomVatRate ?? ROOM_VAT_RATE_BP,
        rooms: this.invoiceRooms(order),
      },
      vat
    );

    const issueDate = new Date();
    const billTo = await this.resolveBillTo(order);
    const first = order.bookings[0];
    // Captured here because the guard above narrowed it; TypeScript does not
    // carry that narrowing into the callback below.
    const relatedInvoiceNumber = order.invoiceNumber;

    // Same shape as the invoice: number, cancellation, PDF and record commit
    // together or not at all. An order credited by a concurrent refund throws
    // AlreadyCredited, which rolls the number back rather than spending it on a
    // document that was never produced.
    const issued = await this.deps.ne26OrderRepository
      .issueWithNumber("credit-note", issueDate.getUTCFullYear(), async (creditNoteNumber, tx) => {
        const count = await this.deps.ne26OrderRepository.creditNoteAndCancel(
          uid,
          creditNoteNumber,
          `/rooms/credit-note/${uid}`,
          tx
        );
        if (count === 0) throw new AlreadyCredited();

        const pdf = await renderInvoicePdf(
          model,
          {
            invoiceNumber: creditNoteNumber,
            relatedInvoiceNumber,
            kind: "credit_note",
            issueDate,
            bookerName: order.bookerName,
            bookerEmail: order.bookerEmail,
            poNumber: order.bookerPoNumber,
            internalReference: order.bookerInternalReference,
            billTo,
            roomName: this.roomLabel(order),
            startUtc: first?.startTime ?? issueDate,
            endUtc: first?.endTime ?? issueDate,
          },
          issuer
        );
        await saveInvoicePdf(uid, pdf, "credit_note");
        return { creditNoteNumber, pdf };
      })
      .catch((e) => {
        if (e instanceof AlreadyCredited) return null;
        throw e;
      });
    if (!issued) return false;
    const { creditNoteNumber, pdf } = issued;

    await sendInvoiceEmail({
      to: order.bookerEmail,
      bookerName: order.bookerName,
      invoiceNumber: creditNoteNumber,
      roomName: this.roomLabel(order),
      rooms: this.emailRooms(order),
      amountLabel: `${(model.totalTtc / 100).toFixed(2)} ${order.currency}`,
      pdf,
      documentKind: "credit_note",
    });
    return true;
  }

  /** Credit from a Stripe refund webhook, resolving the order by payment intent. */
  async issueCreditNoteByPaymentIntent(stripePaymentId: string): Promise<boolean> {
    const order = await this.deps.ne26OrderRepository.findByStripePaymentId(stripePaymentId);
    if (!order) return false;
    return this.issueCreditNote(order.uid);
  }
}
