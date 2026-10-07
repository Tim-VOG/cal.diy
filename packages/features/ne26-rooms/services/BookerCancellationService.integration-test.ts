import { prisma } from "@calcom/prisma";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getInvoiceService } from "../di/InvoiceService.container";
import { getInvoiceSettingsRepository } from "../di/InvoiceSettingsRepository.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "../di/Ne26RoomSettingsRepository.container";
import { getAtomicSlotStarts } from "../lib/atomicSlots";
import { BookerCancellationService, CancellationRefused } from "./BookerCancellationService";

// No SMTP, and above all no mail to anybody: the buyer's credit note and the
// desk's alert are asserted as calls, never sent.
vi.mock("../lib/mailer", () => ({ sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) }));
import { sendInvoiceEmail } from "../lib/mailer";

const orders = getNe26OrderRepository();
const invoices = getInvoiceService();
const STAMP = Date.now();
const MINUTE = 60_000;

/** A Stripe that moves no money and remembers precisely what it was asked for. */
function fakeStripe(behaviour: "ok" | "refuse" = "ok") {
  const calls: { paymentIntentId: string; idempotencyKey: string; amount?: number }[] = [];
  return {
    calls,
    refundPayment: vi.fn(async (paymentIntentId: string, idempotencyKey: string, amount?: number) => {
      calls.push({ paymentIntentId, idempotencyKey, amount });
      if (behaviour === "refuse") throw new Error("Stripe is down");
      return `re_${calls.length}_${STAMP}`;
    }),
  };
}

const notifications: { audience: string; subject: string; body: string }[] = [];
const service = (stripe: ReturnType<typeof fakeStripe>) =>
  new BookerCancellationService({
    ne26OrderRepository: orders,
    invoiceService: invoices,
    refunds: stripe,
    ne26RoomSettingsRepository: getNe26RoomSettingsRepository(),
    invoiceSettingsRepository: getInvoiceSettingsRepository(),
    notifyTeam: async (audience, subject, body) => {
      notifications.push({ audience, subject, body });
    },
    webappUrl: "https://rooms.vo-eu.be",
  });

let roomA: number;
let roomB: number;
let userId: number;
let otherUserId: number;

/** Two rooms on one payment, invoiced — the case that needed room-by-room credit. */
async function paidOrder(
  rooms: { id: number; startUtc: string; price: number }[]
): Promise<{ uid: string; bookingUids: string[] }> {
  const order = await orders.createWithRooms({
    bookerUserId: userId,
    bookerEmail: "cancel@test.com",
    bookerName: "Cancel Tester",
    amountTotal: rooms.reduce((sum, r) => sum + r.price, 0),
    currency: "EUR",
    holdExpiresAt: new Date(Date.now() + 30 * MINUTE),
    rooms: rooms.map((r) => {
      const startTime = new Date(r.startUtc);
      return {
        resourceId: r.id,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * MINUTE),
        durationMinutes: 60,
        slotStarts: getAtomicSlotStarts(startTime, 60),
        amountTotal: r.price,
        addOns: [],
      };
    }),
  });
  if (!order) throw new Error("order not created");
  await orders.confirmPaid(order.uid, `pi_cancel_${STAMP}_${order.uid.slice(0, 8)}`);
  await invoices.issueInvoice(order.uid);
  const read = await orders.findByUid(order.uid);
  return { uid: order.uid, bookingUids: read!.bookings.map((b) => b.uid) };
}

const TWO_ROOMS = () => [
  { id: roomA, startUtc: "2026-11-17T13:00:00.000Z", price: 72000 },
  { id: roomB, startUtc: "2026-11-18T13:00:00.000Z", price: 42000 },
];
// Well before the deadline, which is seven days before the event opens.
const BEFORE_DEADLINE = new Date("2026-10-07T10:00:00.000Z");

describe("BookerCancellationService", () => {
  beforeAll(async () => {
    const make = (n: string, price: number) =>
      prisma.resource.create({
        data: {
          name: `TEST Cancel Room ${n}`,
          slug: `test-cancel-${n}-${STAMP}`,
          category: "ENTRY",
          capacity: 6,
          surface: 18,
          price1h: price,
          price2h: price * 2,
          price3h: price * 3,
        },
        select: { id: true },
      });
    const [a, b] = await Promise.all([make("a", 72000), make("b", 42000)]);
    roomA = a.id;
    roomB = b.id;
    const [one, two] = await Promise.all([
      prisma.user.create({
        data: { email: `cancel-${STAMP}@test.com`, username: `cancel-${STAMP}`, name: "Cancel Tester" },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `other-${STAMP}@test.com`, username: `other-${STAMP}`, name: "Someone Else" },
        select: { id: true },
      }),
    ]);
    userId = one.id;
    otherUserId = two.id;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    notifications.length = 0;
    await prisma.ne26Order.deleteMany({ where: { bookerEmail: "cancel@test.com" } });
    await prisma.resourceBooking.deleteMany({ where: { resourceId: { in: [roomA, roomB] } } });
  });

  afterAll(async () => {
    await prisma.resource.deleteMany({ where: { id: { in: [roomA, roomB] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("refunds that room's amount incl. VAT — and not a cent of the rest", async () => {
    const { uid, bookingUids } = await paidOrder(TWO_ROOMS());
    const stripe = fakeStripe();

    const done = await service(stripe).cancel(bookingUids[0], userId, BEFORE_DEADLINE);

    // 720.00 excl. VAT at 21% = 871.20 incl. The order was 1140.00 excl. VAT.
    expect(stripe.calls).toEqual([
      {
        paymentIntentId: expect.stringContaining("pi_cancel_"),
        idempotencyKey: `ne26-cancel-${bookingUids[0]}`,
        amount: 87120,
      },
    ]);
    expect(done.amountTtc).toBe(87120);
    expect(done.creditNoteNumber).toMatch(/^NE26-CN-\d{4}-\d{4}$/);
  });

  it("credits that room, frees it, and leaves the other one sold and invoiced", async () => {
    const { uid, bookingUids } = await paidOrder(TWO_ROOMS());
    const before = await orders.findByUid(uid);

    await service(fakeStripe()).cancel(bookingUids[0], userId, BEFORE_DEADLINE);

    const after = await orders.findByUid(uid);
    expect(after).toMatchObject({
      status: "CONFIRMED",
      invoiceNumber: before?.invoiceNumber,
      amountTotal: before?.amountTotal,
      creditNoteNumber: null,
    });
    const rooms = Object.fromEntries(after!.bookings.map((b) => [b.uid, b]));
    expect(rooms[bookingUids[0]].status).toBe("CANCELLED");
    expect(rooms[bookingUids[1]]).toMatchObject({ status: "CONFIRMED", creditNoteId: null });
    // Freed means the slots are gone: that is what puts it back on sale.
    expect(await prisma.resourceSlot.count({ where: { booking: { uid: bookingUids[0] } } })).toBe(0);
    expect(
      await prisma.resourceSlot.count({ where: { booking: { uid: bookingUids[1] } } })
    ).toBeGreaterThan(0);

    const notes = await orders.findCreditNotes(uid);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ amountTtc: 87120, closesOrder: false });
    expect(notes[0].bookings.map((b) => b.uid)).toEqual([bookingUids[0]]);
  });

  it("emails the exhibitor their credit note and tells the sales desk", async () => {
    const { bookingUids } = await paidOrder(TWO_ROOMS());
    vi.clearAllMocks();

    await service(fakeStripe()).cancel(bookingUids[0], userId, BEFORE_DEADLINE);

    expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0]).toMatchObject({
      to: "cancel@test.com",
      documentKind: "credit_note",
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].audience).toBe("sales");
    expect(notifications[0].subject).toContain("Cancelled by the exhibitor");
    expect(notifications[0].body).toContain("871.20 EUR");
  });

  it("pays out once when the button is pressed twice", async () => {
    const { uid, bookingUids } = await paidOrder(TWO_ROOMS());
    const stripe = fakeStripe();
    const svc = service(stripe);

    await svc.cancel(bookingUids[0], userId, BEFORE_DEADLINE);
    await expect(svc.cancel(bookingUids[0], userId, BEFORE_DEADLINE)).rejects.toBeInstanceOf(
      CancellationRefused
    );

    expect(stripe.calls).toHaveLength(1);
    expect(await orders.findCreditNotes(uid)).toHaveLength(1);
  });

  it("cancels nothing when Stripe refuses, and lets them try again", async () => {
    const { uid, bookingUids } = await paidOrder(TWO_ROOMS());

    await expect(
      service(fakeStripe("refuse")).cancel(bookingUids[0], userId, BEFORE_DEADLINE)
    ).rejects.toThrow("Stripe is down");

    const after = await orders.findByUid(uid);
    expect(after?.bookings.every((b) => b.status === "CONFIRMED")).toBe(true);
    expect(await orders.findCreditNotes(uid)).toEqual([]);
    // The claim was handed back, so a retry goes through.
    const retry = await service(fakeStripe()).cancel(bookingUids[0], userId, BEFORE_DEADLINE);
    expect(retry.creditNoteNumber).toMatch(/^NE26-CN-/);
  });

  it("closes the order when the last room goes", async () => {
    const { uid, bookingUids } = await paidOrder(TWO_ROOMS());
    const svc = service(fakeStripe());

    await svc.cancel(bookingUids[0], userId, BEFORE_DEADLINE);
    const last = await svc.cancel(bookingUids[1], userId, BEFORE_DEADLINE);

    const after = await orders.findByUid(uid);
    expect(after).toMatchObject({ status: "CANCELLED", creditNoteNumber: last.creditNoteNumber });
  });

  it("refuses somebody else's booking, and says nothing about whose it is", async () => {
    const { bookingUids } = await paidOrder(TWO_ROOMS());
    const stripe = fakeStripe();

    await expect(service(stripe).cancel(bookingUids[0], otherUserId, BEFORE_DEADLINE)).rejects.toMatchObject(
      { reason: "not-found", message: "No such booking." }
    );
    expect(stripe.calls).toEqual([]);
  });

  it("refuses once the deadline has passed, and refunds nothing", async () => {
    const { bookingUids } = await paidOrder(TWO_ROOMS());
    const stripe = fakeStripe();

    await expect(
      // Three days before the event: self-service closed seven days before.
      service(stripe).cancel(bookingUids[0], userId, new Date("2026-11-14T10:00:00.000Z"))
    ).rejects.toMatchObject({ reason: "deadline-passed" });
    expect(stripe.calls).toEqual([]);
  });
});
