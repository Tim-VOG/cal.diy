import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getInvoiceService } from "../di/InvoiceService.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { readInvoicePdf } from "../lib/invoiceStorage";

// Don't hit real SMTP; assert the mailer is invoked correctly.
vi.mock("../lib/mailer", () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendInvoiceEmail } from "../lib/mailer";

const service = getInvoiceService();
const orders = getNe26OrderRepository();
const MS_PER_MINUTE = 60 * 1000;
const STAMP = Date.now();

let roomA: number;
let roomB: number;
// Orders here are attached to an account on purpose: the counter hold cap
// counts account-less orders globally, so leaving these unattached would
// inflate the count for the suite that tests that cap.
let userId: number;

/** One paid order. `rooms` lets a test ask for the multi-room case. */
async function confirmedOrder(
  rooms: { id: number; startUtc: string; price: number }[] = [
    { id: roomA, startUtc: "2026-11-17T13:00:00.000Z", price: 35000 },
  ]
): Promise<string> {
  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: "invoice@test.com",
    bookerName: "Invoice Tester",
    amountTotal: rooms.reduce((sum, r) => sum + r.price, 0),
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 30 * MS_PER_MINUTE),
    rooms: rooms.map((r) => {
      const startTime = new Date(r.startUtc);
      return {
        resourceId: r.id,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
        durationMinutes: 60,
        slotStarts: getAtomicSlotStarts(startTime, 60),
        amountTotal: r.price,
        addOns: [],
      };
    }),
  });
  if (!order) throw new Error("order not created");
  await orders.confirmPaid(order.uid, `pi_${STAMP}_${order.uid.slice(0, 8)}`);
  return order.uid;
}

describe("InvoiceService.issueInvoice", () => {
  beforeAll(async () => {
    const make = (n: string) =>
      prisma.resource.create({
        data: {
          name: `TEST Invoice Room ${n}`,
          slug: `test-invoice-${n}-${STAMP}`,
          category: "ENTRY",
          capacity: 6,
          surface: 18,
          price1h: 35000,
          price2h: 65000,
          price3h: 90000,
        },
        select: { id: true },
      });
    const [a, b] = await Promise.all([make("a"), make("b")]);
    roomA = a.id;
    roomB = b.id;

    const user = await prisma.user.create({
      data: { email: `invoice-${STAMP}@test.com`, username: `invoice-${STAMP}`, name: "Invoice Tester" },
      select: { id: true },
    });
    userId = user.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: "invoice@test.com" } });
    await prisma.resourceBooking.deleteMany({ where: { resourceId: { in: [roomA, roomB] } } });
  });

  afterAll(async () => {
    await prisma.resource.deleteMany({ where: { id: { in: [roomA, roomB] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("allocates a number, stores a PDF, persists the invoice, and emails it", async () => {
    const uid = await confirmedOrder();

    await service.issueInvoice(uid);

    const order = await orders.findByUid(uid);
    expect(order?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);
    expect(order?.invoicePdfUrl).toBe(`/rooms/invoice/${uid}`);

    const pdf = await readInvoicePdf(uid);
    expect(pdf).not.toBeNull();
    expect(new TextDecoder().decode(pdf!.subarray(0, 5))).toBe("%PDF-");

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0]).toMatchObject({ to: "invoice@test.com" });
  });

  it("is idempotent: a second call does not re-issue or re-email", async () => {
    const uid = await confirmedOrder();
    await service.issueInvoice(uid);
    const first = (await orders.findByUid(uid))?.invoiceNumber;
    await service.issueInvoice(uid);
    const second = (await orders.findByUid(uid))?.invoiceNumber;

    expect(second).toBe(first);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  // One payment covering several rooms must produce ONE document, not one per
  // room: the buyer was charged once and is owed a single invoice for it.
  describe("an order covering several rooms", () => {
    const TWO_ROOMS = () => [
      { id: roomA, startUtc: "2026-11-17T13:00:00.000Z", price: 35000 },
      { id: roomB, startUtc: "2026-11-18T13:00:00.000Z", price: 35000 },
    ];

    it("issues a single invoice number for the whole order", async () => {
      const uid = await confirmedOrder(TWO_ROOMS());
      await service.issueInvoice(uid);

      const order = await orders.findByUid(uid);
      expect(order?.bookings).toHaveLength(2);
      expect(order?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    });

    it("names one room and counts the rest in the email subject line", async () => {
      const uid = await confirmedOrder(TWO_ROOMS());
      await service.issueInvoice(uid);
      expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0].roomName).toMatch(/\+ 1 more$/);
    });

    it("credits the whole order at once and frees every room", async () => {
      const uid = await confirmedOrder(TWO_ROOMS());
      await service.issueInvoice(uid);
      expect(await service.issueCreditNote(uid)).toBe(true);

      // Both rooms back on sale: a room left holding its slots would be
      // unsellable for the rest of the event.
      const left = await prisma.resourceBooking.count({ where: { orderUid: uid } });
      expect(left).toBe(0);
      const order = await orders.findByUid(uid);
      expect(order?.creditNoteNumber).toMatch(/^NE26-CN-2026-\d{4}$/);
    });
  });

  // What the admin buttons do: they address the ORDER, so confirming or
  // cancelling reaches every room the one payment covered.
  describe("admin actions on an order", () => {
    /** A held, unpaid order — what an admin confirming a bank transfer sees. */
    async function pendingOrder(rooms = 2) {
      const order = await orders.createWithRooms({
        bookerUserId: userId,
        bookerEmail: "invoice@test.com",
        bookerName: "Invoice Tester",
        amountTotal: 35000 * rooms,
        currency: "EUR",
        holdExpiresAt: new Date(Date.now() + 30 * MS_PER_MINUTE),
        rooms: [
          { id: roomA, startUtc: "2026-11-17T13:00:00.000Z" },
          { id: roomB, startUtc: "2026-11-18T13:00:00.000Z" },
        ]
          .slice(0, rooms)
          .map((r) => {
            const startTime = new Date(r.startUtc);
            return {
              resourceId: r.id,
              startTime,
              endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
              durationMinutes: 60,
              slotStarts: getAtomicSlotStarts(startTime, 60),
              amountTotal: 35000,
              addOns: [],
            };
          }),
      });
      if (!order) throw new Error("order not created");
      return order.uid;
    }

    it("confirms a bank transfer and issues one invoice for every room", async () => {
      const uid = await pendingOrder();
      // Null payment id is what marks it settled off-Stripe.
      expect(await orders.confirmPaid(uid, null)).toBe(true);
      await service.issueInvoice(uid);

      const order = await orders.findByUid(uid);
      expect(order?.status).toBe(ResourceBookingStatus.CONFIRMED);
      expect(order?.stripePaymentId).toBeNull();
      expect(order?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
      const rows = await prisma.resourceBooking.findMany({
        where: { orderUid: uid },
        select: { status: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === ResourceBookingStatus.CONFIRMED)).toBe(true);
    });

    it("refuses to confirm an order that is already paid", async () => {
      const uid = await pendingOrder(1);
      expect(await orders.confirmPaid(uid, null)).toBe(true);
      // A second click must not re-confirm and burn a second invoice number.
      expect(await orders.confirmPaid(uid, null)).toBe(false);
    });

    it("cancelling a pending order frees every room it held", async () => {
      const uid = await pendingOrder();
      expect(await orders.cancelPending(uid)).toBe(true);

      expect(await orders.findByUid(uid)).toBeNull();
      // Deleted, not marked cancelled: a cancelled row keeping its slots would
      // leave both rooms unsellable for the rest of the event.
      const slots = await prisma.resourceSlot.count({
        where: { resourceId: { in: [roomA, roomB] } },
      });
      expect(slots).toBe(0);
    });

    it("never cancels an order that has been paid", async () => {
      const uid = await pendingOrder(1);
      await orders.confirmPaid(uid, "pi_admin_paid");

      expect(await orders.cancelPending(uid)).toBe(false);
      expect((await orders.findByUid(uid))?.status).toBe(ResourceBookingStatus.CONFIRMED);
    });
  });

  // The defect this closes: nothing froze VAT, so the credit note was recomputed
  // from the LIVE settings while the invoice PDF stayed as issued — an admin
  // correcting the catering rate made the two documents disagree.
  describe("VAT is frozen onto the order", () => {
    it("records the treatment on the order when the invoice is issued", async () => {
      const uid = await confirmedOrder();
      await service.issueInvoice(uid);

      const order = await prisma.ne26Order.findUniqueOrThrow({
        where: { uid },
        select: { roomVatRate: true, vatZeroRated: true, vatMention: true },
      });
      expect(order).toEqual({ roomVatRate: 2100, vatZeroRated: false, vatMention: null });
    });

    it("does not re-read the VAT matrix when crediting", async () => {
      const uid = await confirmedOrder();
      await service.issueInvoice(uid);

      // Flip the matrix so a live recomputation would zero-rate this order.
      await prisma.ne26Order.update({ where: { uid }, data: { bookerCountry: "US" } });
      await prisma.ne26InvoiceSettings.upsert({
        where: { id: 1 },
        update: { nonEuExemptEnabled: true },
        create: { id: 1, nonEuExemptEnabled: true },
      });
      try {
        expect(await service.issueCreditNote(uid)).toBe(true);
        // Still the treatment the invoice was issued with, not the new one.
        const after = await prisma.ne26Order.findUniqueOrThrow({
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
