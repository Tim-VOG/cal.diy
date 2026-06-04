import { ResourceBookingStatus } from "@calcom/prisma/enums";

import { buildInvoiceModel } from "../lib/invoice";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { saveInvoicePdf } from "../lib/invoiceStorage";
import { sendInvoiceEmail } from "../lib/mailer";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";

export interface IInvoiceServiceDeps {
  resourceBookingRepository: ResourceBookingRepository;
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

    const model = buildInvoiceModel({
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
    });

    const invoiceNumber = await this.deps.resourceBookingRepository.allocateInvoiceNumber();
    const pdf = await renderInvoicePdf(model, {
      invoiceNumber,
      issueDate: new Date(),
      bookerName: booking.bookerName,
      bookerEmail: booking.bookerEmail,
      roomName: booking.resource.name,
      startUtc: booking.startTime,
      endUtc: booking.endTime,
    });

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
}
