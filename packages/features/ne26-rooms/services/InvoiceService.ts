import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { buildInvoiceModel } from "../lib/invoice";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { saveInvoicePdf } from "../lib/invoiceStorage";
import { sendInvoiceEmail } from "../lib/mailer";
import { resolveVatTreatment } from "../lib/vat";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";

export interface IInvoiceServiceDeps {
  resourceBookingRepository: ResourceBookingRepository;
  invoiceSettingsRepository: InvoiceSettingsRepository;
}

export class InvoiceService {
  constructor(private deps: IInvoiceServiceDeps) {}

  /**
   * Issue the invoice for a confirmed booking: allocate a sequential number,
   * render the PDF, store it, persist invoiceNumber/invoicePdfUrl, then email it.
   * Idempotent: no-op if the booking is missing, not CONFIRMED, or already invoiced.
   */
  async issueInvoice(uid: string): Promise<void> {
    const booking = await this.deps.resourceBookingRepository.findByUidForInvoice(uid);
    if (!booking || booking.status !== ResourceBookingStatus.CONFIRMED || booking.invoiceNumber) return;

    const issuer = await this.deps.invoiceSettingsRepository.get();
    const vat = resolveVatTreatment(
      { country: booking.bookerCountry, vatNumber: booking.bookerVatNumber },
      issuer
    );
    const model = buildInvoiceModel(
      {
        amountTotal: booking.amountTotal,
        currency: booking.currency,
        roomName: booking.resource.name,
        durationMinutes: booking.durationMinutes,
        addOns: booking.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.addOn.vatRate,
        })),
      },
      vat
    );

    const invoiceNumber = await this.deps.resourceBookingRepository.allocateInvoiceNumber();
    const pdf = await renderInvoicePdf(
      model,
      {
        invoiceNumber,
        issueDate: new Date(),
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        roomName: booking.resource.name,
        startUtc: booking.startTime,
        endUtc: booking.endTime,
      },
      issuer
    );

    await saveInvoicePdf(uid, pdf);
    // Persist before emailing: the invoice now exists (idempotency anchor); a
    // failed email is logged by the caller and can be resent, without re-issuing.
    await this.deps.resourceBookingRepository.setInvoice(uid, invoiceNumber, `/rooms/invoice/${uid}`);
    await sendInvoiceEmail({
      to: booking.bookerEmail,
      bookerName: booking.bookerName,
      invoiceNumber,
      roomName: booking.resource.name,
      amountLabel: `${(booking.amountTotal / 100).toFixed(2)} ${booking.currency}`,
      pdf,
    });
  }

  /**
   * Issue a credit note that cancels a confirmed, invoiced booking (full refund):
   * allocate a CN number, cancel the booking + free its slots, render/store the
   * credit-note PDF, and email it. Idempotent (no-op if not eligible or already
   * credited). Returns true if a credit note was issued.
   */
  async issueCreditNote(uid: string): Promise<boolean> {
    const booking = await this.deps.resourceBookingRepository.findByUidForInvoice(uid);
    if (
      !booking ||
      booking.status !== ResourceBookingStatus.CONFIRMED ||
      !booking.invoiceNumber ||
      booking.creditNoteNumber
    ) {
      return false;
    }

    const issuer = await this.deps.invoiceSettingsRepository.get();
    const vat = resolveVatTreatment(
      { country: booking.bookerCountry, vatNumber: booking.bookerVatNumber },
      issuer
    );
    const model = buildInvoiceModel(
      {
        amountTotal: booking.amountTotal,
        currency: booking.currency,
        roomName: booking.resource.name,
        durationMinutes: booking.durationMinutes,
        addOns: booking.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.addOn.vatRate,
        })),
      },
      vat
    );

    const creditNoteNumber = await this.deps.resourceBookingRepository.allocateCreditNoteNumber();
    // Anchor first (atomic, cancels + frees slots); only the winner proceeds.
    const count = await this.deps.resourceBookingRepository.creditNoteAndCancel(
      uid,
      creditNoteNumber,
      `/rooms/credit-note/${uid}`
    );
    if (count === 0) return false;

    const pdf = await renderInvoicePdf(
      model,
      {
        invoiceNumber: creditNoteNumber,
        relatedInvoiceNumber: booking.invoiceNumber,
        kind: "credit_note",
        issueDate: new Date(),
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        roomName: booking.resource.name,
        startUtc: booking.startTime,
        endUtc: booking.endTime,
      },
      issuer
    );
    await saveInvoicePdf(uid, pdf, "credit_note");
    await sendInvoiceEmail({
      to: booking.bookerEmail,
      bookerName: booking.bookerName,
      invoiceNumber: creditNoteNumber,
      roomName: booking.resource.name,
      amountLabel: `${(booking.amountTotal / 100).toFixed(2)} ${booking.currency}`,
      pdf,
      documentKind: "credit_note",
    });
    return true;
  }

  /** Issue a credit note from a Stripe refund webhook (resolve booking by payment intent). */
  async issueCreditNoteByPaymentIntent(stripePaymentId: string): Promise<boolean> {
    const uid = await this.deps.resourceBookingRepository.findUidByStripePaymentId(stripePaymentId);
    if (!uid) return false;
    return this.issueCreditNote(uid);
  }
}
