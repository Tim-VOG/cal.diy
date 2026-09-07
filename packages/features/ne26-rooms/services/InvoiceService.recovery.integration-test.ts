import { prisma } from "@calcom/prisma";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getInvoiceService } from "../di/InvoiceService.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { readInvoicePdf } from "../lib/invoiceStorage";

vi.mock("../lib/mailer", () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));

import { sendInvoiceEmail } from "../lib/mailer";

/**
 * The recovery path: a paid order whose invoice never came out, invoiced later
 * by an admin pressing a button.
 *
 * Reachable from the admin screens for the first time, which is what makes it
 * worth pinning down. The button is guarded, but the button is not the boundary
 * — the tRPC procedure behind it takes any order uid an admin cares to send.
 */

const service = getInvoiceService();
const orders = getNe26OrderRepository();
const MS_PER_MINUTE = 60 * 1000;
const STAMP = Date.now();
const made: string[] = [];

let roomId: number;
let userId: number;
let slot = 0;

/** A paid order with no invoice: exactly what the recovery button is aimed at. */
async function paidUninvoicedOrder(): Promise<string> {
  // Each order takes its own hour, or the anti-double-booking constraint (quite
  // rightly) refuses the second one.
  const startTime = new Date(Date.UTC(2026, 10, 17, 6 + slot++, 0, 0));
  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: "recovery@test.com",
    bookerName: "Recovery Tester",
    amountTotal: 35000,
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 30 * MS_PER_MINUTE),
    rooms: [
      {
        resourceId: roomId,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
        durationMinutes: 60,
        slotStarts: getAtomicSlotStarts(startTime, 60),
        amountTotal: 35000,
        addOns: [],
      },
    ],
  });
  if (!order) throw new Error("order not created");
  made.push(order.uid);
  await orders.confirmPaid(order.uid, `pi_rec_${STAMP}_${order.uid.slice(0, 8)}`);
  return order.uid;
}

/**
 * A confirmed order holding nothing. Not reachable through the app — confirmPaid
 * refuses to record a sale with no rooms — so it is built directly, which is
 * also how it would arrive in real life: somebody editing the database.
 */
async function confirmedWithNoRooms(): Promise<string> {
  const order = await prisma.ne26Order.create({
    data: {
      bookerUserId: userId,
      bookerEmail: "empty@test.com",
      bookerName: "Empty Order",
      amountTotal: 35000,
      currency: "EUR",
      status: "CONFIRMED",
      stripePaymentId: `pi_empty_${STAMP}_${Math.random().toString(36).slice(2, 8)}`,
      paidAt: new Date(),
    },
  });
  made.push(order.uid);
  return order.uid;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `recovery-${STAMP}@test.com`, username: `recovery-${STAMP}` },
  });
  userId = user.id;
  const room = await prisma.resource.create({
    data: {
      name: "TEST Recovery Room",
      slug: `test-recovery-${STAMP}`,
      category: "ENTRY",
      capacity: 6,
      surface: 18,
      price1h: 35000,
      price2h: 60000,
      price3h: 80000,
    },
  });
  roomId = room.id;
});

afterEach(() => {
  vi.mocked(sendInvoiceEmail).mockClear();
});

describe("recovering an invoice that never came out", () => {
  it("issues it, stores the PDF and emails the buyer", async () => {
    const uid = await paidUninvoicedOrder();

    await service.issueInvoice(uid);

    const order = await orders.findByUid(uid);
    expect(order?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);
    const pdf = await readInvoicePdf(uid);
    expect(new TextDecoder().decode(pdf!.subarray(0, 5))).toBe("%PDF-");
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it("leaves no hole in the series when it runs late", async () => {
    // The recovery happens after other sales have taken their numbers. A gap in
    // an invoice series has to be justified to an auditor, so it must not
    // appear just because a document was raised out of order.
    const late = await paidUninvoicedOrder();
    const a = await paidUninvoicedOrder();
    const b = await paidUninvoicedOrder();

    await service.issueInvoice(a);
    await service.issueInvoice(b);
    await service.issueInvoice(late);

    const numbers = await Promise.all(
      [a, b, late].map(async (uid) => (await orders.findByUid(uid))?.invoiceNumber ?? "")
    );
    const seq = numbers.map((n) => Number(n.slice(-4)));
    expect(seq[1]).toBe(seq[0] + 1);
    expect(seq[2]).toBe(seq[1] + 1);
  });

  it("spends no second number when pressed twice", async () => {
    const uid = await paidUninvoicedOrder();
    await service.issueInvoice(uid);
    const first = (await orders.findByUid(uid))?.invoiceNumber;
    await service.issueInvoice(uid);

    expect((await orders.findByUid(uid))?.invoiceNumber).toBe(first);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });
});

describe("an order holding no rooms is never invoiced", () => {
  it("refuses rather than issuing a document that lists nothing", async () => {
    // The button is hidden for this case, but the button is not the boundary:
    // the procedure behind it takes any uid an admin sends. Issuing here would
    // spend a number from a gapless series on an invoice for no rooms, and mail
    // it to the buyer — worse than the dead end it was meant to repair.
    const uid = await confirmedWithNoRooms();

    await service.issueInvoice(uid);

    const order = await orders.findByUid(uid);
    expect(order?.invoiceNumber).toBeNull();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("takes no number from the counter", async () => {
    const before = await prisma.ne26DocumentCounter.findUnique({ where: { series: "invoice" } });
    const uid = await confirmedWithNoRooms();
    await service.issueInvoice(uid);
    const after = await prisma.ne26DocumentCounter.findUnique({ where: { series: "invoice" } });

    expect(after?.lastNumber ?? 0).toBe(before?.lastNumber ?? 0);
  });
});
