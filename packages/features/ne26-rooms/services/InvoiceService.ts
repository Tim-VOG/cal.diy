import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { buildBookingIcs } from "../lib/ics";
import { ROOM_VAT_RATE_BP, buildInvoiceModel } from "../lib/invoice";
import type { InvoiceMeta } from "../lib/invoicePdf";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { readInvoicePdf, saveInvoicePdf } from "../lib/invoiceStorage";
import { sendInvoiceEmail } from "../lib/mailer";
import { formatSlotRange } from "../lib/teamNotification";
import { resolveVatTreatment } from "../lib/vat";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import type { Ne26BillingProfileRepository } from "../repositories/Ne26BillingProfileRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";

export interface IInvoiceServiceDeps {
  resourceBookingRepository: ResourceBookingRepository;
  invoiceSettingsRepository: InvoiceSettingsRepository;
  ne26BillingProfileRepository: Ne26BillingProfileRepository;
}

export class InvoiceService {
  constructor(private deps: IInvoiceServiceDeps) {}

  /**
   * Resolve the invoice "Bill to" details: the full address comes from the
   * exhibitor's saved billing profile (which also pre-fills Stripe Checkout),
   * while country/VAT prefer the booking's values — these are synced back from
   * what the buyer actually confirmed at checkout — so VAT display matches the
   * VAT treatment used to compute the totals.
   */
  private async resolveBillTo(booking: {
    bookerUserId: number | null;
    bookerCountry: string | null;
    bookerVatNumber: string | null;
    bookerLegalName?: string | null;
    bookerAddressLine1?: string | null;
    bookerAddressLine2?: string | null;
    bookerPostalCode?: string | null;
    bookerCity?: string | null;
  }): Promise<NonNullable<InvoiceMeta["billTo"]>> {
    const profile = booking.bookerUserId
      ? await this.deps.ne26BillingProfileRepository.findByUserId(booking.bookerUserId)
      : null;

    // What the buyer confirmed at Checkout wins over the saved profile. On a
    // counter sale there is no profile at all — the exhibitor has no account, and
    // the address on these columns is the only one that exists. On a web booking
    // they are empty, so the profile still supplies it.
    return {
      legalName: booking.bookerLegalName || profile?.legalName || null,
      addressLine1: booking.bookerAddressLine1 || profile?.addressLine1 || null,
      addressLine2: booking.bookerAddressLine2 || profile?.addressLine2 || null,
      postalCode: booking.bookerPostalCode || profile?.postalCode || null,
      city: booking.bookerCity || profile?.city || null,
      country: booking.bookerCountry || profile?.country || null,
      vatNumber: booking.bookerVatNumber || profile?.vatNumber || null,
    };
  }

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
    // The rate in force for this order; frozen onto the booking below.
    const roomVatRate = ROOM_VAT_RATE_BP;
    const model = buildInvoiceModel(
      {
        amountTotal: booking.amountTotal,
        currency: booking.currency,
        roomName: booking.resource.name,
        durationMinutes: booking.durationMinutes,
        slotLabel: formatSlotRange(booking.startTime, booking.endTime),
        addOns: booking.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.vatRate,
        })),
        roomVatRate,
      },
      vat
    );

    // Year comes from the issue date, not a literal: a document raised in January
    // 2027 (a late invoice, a refund) was being stamped 2026.
    const issueDate = new Date();
    const invoiceNumber = await this.deps.resourceBookingRepository.allocateInvoiceNumber(
      issueDate.getUTCFullYear()
    );
    const billTo = await this.resolveBillTo(booking);
    const pdf = await renderInvoicePdf(
      model,
      {
        invoiceNumber,
        issueDate,
        // A booking with no Stripe payment id was confirmed offline (bank transfer).
        paidViaStripe: Boolean(booking.stripePaymentId),
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        poNumber: booking.bookerPoNumber,
        internalReference: booking.bookerInternalReference,
        billTo,
        roomName: booking.resource.name,
        startUtc: booking.startTime,
        endUtc: booking.endTime,
      },
      issuer
    );

    await saveInvoicePdf(uid, pdf);
    // Persist before emailing: the invoice now exists (idempotency anchor); a
    // failed email is logged by the caller and can be resent, without re-issuing.
    await this.deps.resourceBookingRepository.setInvoice(uid, invoiceNumber, `/rooms/invoice/${uid}`, {
      roomVatRate,
      zeroRated: vat.zeroRated,
      mention: vat.mention,
    });
    await sendInvoiceEmail({
      to: booking.bookerEmail,
      bookerName: booking.bookerName,
      invoiceNumber,
      roomName: booking.resource.name,
      amountLabel: `${(booking.amountTotal / 100).toFixed(2)} ${booking.currency}`,
      pdf,
      ics: buildBookingIcs({
        uid: booking.uid,
        roomName: booking.resource.name,
        startUtc: booking.startTime,
        endUtc: booking.endTime,
      }),
    });
  }

  /**
   * Re-send an already-issued invoice email (admin action, e.g. the booker lost
   * it). Reads the stored PDF and re-sends; no-op if the booking has no invoice
   * or the PDF is missing. Returns true if an email was sent.
   */
  async resendInvoice(uid: string): Promise<boolean> {
    const booking = await this.deps.resourceBookingRepository.findByUidForInvoice(uid);
    if (!booking?.invoiceNumber) return false;
    const pdf = await readInvoicePdf(uid, "invoice");
    if (!pdf) return false;
    await sendInvoiceEmail({
      to: booking.bookerEmail,
      bookerName: booking.bookerName,
      invoiceNumber: booking.invoiceNumber,
      roomName: booking.resource.name,
      amountLabel: `${(booking.amountTotal / 100).toFixed(2)} ${booking.currency}`,
      pdf,
    });
    return true;
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
    // Re-use the treatment FROZEN when the invoice was issued — never recompute
    // from the live settings. The invoice PDF is stored and immutable, so a rate
    // corrected or a reverse-charge toggle flipped since then would produce a
    // credit note that contradicts the invoice it credits.
    const vat = { zeroRated: booking.vatZeroRated, mention: booking.vatMention };
    const model = buildInvoiceModel(
      {
        amountTotal: booking.amountTotal,
        currency: booking.currency,
        roomName: booking.resource.name,
        durationMinutes: booking.durationMinutes,
        slotLabel: formatSlotRange(booking.startTime, booking.endTime),
        addOns: booking.addOns.map((a) => ({
          name: a.addOn.name,
          quantity: a.quantity,
          lineTotal: a.lineTotal,
          vatRate: a.vatRate,
        })),
        roomVatRate: booking.roomVatRate ?? ROOM_VAT_RATE_BP,
      },
      vat
    );

    const issueDate = new Date();
    const creditNoteNumber = await this.deps.resourceBookingRepository.allocateCreditNoteNumber(
      issueDate.getUTCFullYear()
    );
    // Anchor first (atomic, cancels + frees slots); only the winner proceeds.
    const count = await this.deps.resourceBookingRepository.creditNoteAndCancel(
      uid,
      creditNoteNumber,
      `/rooms/credit-note/${uid}`
    );
    if (count === 0) return false;

    const billTo = await this.resolveBillTo(booking);
    const pdf = await renderInvoicePdf(
      model,
      {
        invoiceNumber: creditNoteNumber,
        relatedInvoiceNumber: booking.invoiceNumber,
        kind: "credit_note",
        issueDate,
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        poNumber: booking.bookerPoNumber,
        internalReference: booking.bookerInternalReference,
        billTo,
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
