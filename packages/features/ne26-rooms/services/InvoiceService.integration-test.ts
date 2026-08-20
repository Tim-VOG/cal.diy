import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getInvoiceService } from "../di/InvoiceService.container";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { readInvoicePdf } from "../lib/invoiceStorage";

// Don't hit real SMTP; assert the mailer is invoked correctly.
vi.mock("../lib/mailer", () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendInvoiceEmail } from "../lib/mailer";

const service = getInvoiceService();
const repo = getResourceBookingRepository();
const MS_PER_MINUTE = 60 * 1000;
const SLUG = `test-invoice-${Date.now()}`;

let resourceId: number;

async function confirmedBooking(): Promise<string> {
  const startTime = new Date("2026-11-17T13:00:00.000Z");
  const booking = await repo.createWithSlots({
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
    durationMinutes: 60,
    slotStarts: getAtomicSlotStarts(startTime, 60),
    bookerEmail: "invoice@test.com",
    bookerName: "Invoice Tester",
    amountTotal: 35000,
    currency: "EUR",
    status: ResourceBookingStatus.CONFIRMED,
    holdExpiresAt: null,
  });
  return booking.uid;
}

describe("InvoiceService.issueInvoice", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: {
        name: "TEST Invoice Room",
        slug: SLUG,
        category: "ENTRY",
        capacity: 6,
        surface: 18,
        price1h: 35000,
        price2h: 65000,
        price3h: 90000,
      },
      select: { id: true },
    });
    resourceId = room.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  it("allocates a number, stores a PDF, persists the invoice, and emails it", async () => {
    const uid = await confirmedBooking();

    await service.issueInvoice(uid);

    const booking = await repo.findByUid(uid);
    expect(booking?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);
    expect(booking?.invoicePdfUrl).toBe(`/rooms/invoice/${uid}`);

    const pdf = await readInvoicePdf(uid);
    expect(pdf).not.toBeNull();
    expect(new TextDecoder().decode(pdf!.subarray(0, 5))).toBe("%PDF-");

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0]).toMatchObject({ to: "invoice@test.com" });
  });

  it("is idempotent: a second call does not re-issue or re-email", async () => {
    const uid = await confirmedBooking();
    await service.issueInvoice(uid);
    const first = (await repo.findByUid(uid))?.invoiceNumber;
    await service.issueInvoice(uid);
    const second = (await repo.findByUid(uid))?.invoiceNumber;

    expect(second).toBe(first);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  // The defect this closes: nothing froze VAT, so the credit note was recomputed
  // from the LIVE settings while the invoice PDF stayed as issued — an admin
  // correcting the catering rate made the two documents disagree.
  describe("VAT is frozen onto the order", () => {
    it("records the treatment on the booking when the invoice is issued", async () => {
      const uid = await confirmedBooking();
      await service.issueInvoice(uid);

      const booking = await prisma.resourceBooking.findUniqueOrThrow({
        where: { uid },
        select: { roomVatRate: true, vatZeroRated: true, vatMention: true },
      });
      expect(booking).toEqual({ roomVatRate: 2100, vatZeroRated: false, vatMention: null });
    });

    it("does not re-read the VAT matrix when crediting", async () => {
      const uid = await confirmedBooking();
      await service.issueInvoice(uid);

      // Flip the matrix so a live recomputation would zero-rate this booking.
      await prisma.resourceBooking.update({ where: { uid }, data: { bookerCountry: "US" } });
      await prisma.ne26InvoiceSettings.upsert({
        where: { id: 1 },
        update: { nonEuExemptEnabled: true },
        create: { id: 1, nonEuExemptEnabled: true },
      });

      try {
        expect(await service.issueCreditNote(uid)).toBe(true);
        // Still the treatment the invoice was issued with, not the new one.
        const after = await prisma.resourceBooking.findUniqueOrThrow({
          where: { uid },
          select: { vatZeroRated: true, vatMention: true },
        });
        expect(after).toEqual({ vatZeroRated: false, vatMention: null });
      } finally {
        await prisma.ne26InvoiceSettings.update({
          where: { id: 1 },
          data: { nonEuExemptEnabled: false },
        });
      }
    });
  });
});
