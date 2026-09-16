import { describe, expect, it } from "vitest";
import { type AttentionInput, attentionCount, needsAttention } from "./needsAttention";

const NOW = new Date("2026-09-16T07:45:00.000Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const room = (
  over: Partial<AttentionInput["bookings"][number]> = {}
): AttentionInput["bookings"][number] => ({
  orderUid: "order-a",
  status: "CONFIRMED",
  roomName: "Suite 1",
  bookerName: "Marta Lindqvist",
  amountTotal: 183600,
  currency: "EUR",
  invoiceNumber: "NE26-2026-0001",
  holdExpiresAt: null,
  ...over,
});

const run = (over: Partial<AttentionInput>) =>
  needsAttention({ now: NOW, orphanOrders: [], bookings: [], configIssues: [], ...over });

describe("needsAttention", () => {
  it("is empty when nothing needs a person", () => {
    expect(run({ bookings: [room()] })).toEqual([]);
  });

  it("puts money captured with no room above everything", () => {
    const items = run({
      orphanOrders: [
        { uid: "o1", bookerName: "K", amountTotal: 75600, currency: "EUR", stripePaymentId: "pi_1" },
      ],
      bookings: [
        room({ orderUid: "h1", status: "PENDING", invoiceNumber: null, holdExpiresAt: inMinutes(3) }),
      ],
      configIssues: [
        { key: "STRIPE_PRIVATE_KEY", level: "warning", title: "Stripe is in test mode", detail: "" },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(["paid-no-room", "config", "hold-expiring"]);
    expect(items[0]).toMatchObject({ severity: "critical", href: "/rooms/admin/order/o1" });
  });

  it("names a paid order whose invoice never came out, once per order", () => {
    const items = run({
      bookings: [
        room({ orderUid: "o2", invoiceNumber: null }),
        room({ orderUid: "o2", invoiceNumber: null, roomName: "Suite 2" }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "invoice-missing",
      actionLabel: "Issue the missing invoice",
      href: "/rooms/admin/order/o2",
    });
    expect(items[0].detail).toContain("2 rooms");
    expect(items[0].detail).toContain("€3,672.00");
  });

  it("warns about a hold only when it is close to lapsing", () => {
    const soon = run({
      bookings: [room({ status: "PENDING", invoiceNumber: null, holdExpiresAt: inMinutes(4) })],
    });
    expect(soon[0]).toMatchObject({ kind: "hold-expiring", severity: "warning", expiresAt: inMinutes(4) });

    const later = run({
      bookings: [room({ status: "PENDING", invoiceNumber: null, holdExpiresAt: inMinutes(25) })],
    });
    expect(later.map((i) => i.kind)).toEqual(["holds-running"]);
    expect(later[0].severity).toBe("info");
  });

  it("leaves out a hold that has already lapsed", () => {
    expect(
      run({ bookings: [room({ status: "PENDING", invoiceNumber: null, holdExpiresAt: inMinutes(-1) })] })
    ).toEqual([]);
  });

  it("does not call a pending hold an invoice problem", () => {
    const items = run({
      bookings: [room({ status: "PENDING", invoiceNumber: null, holdExpiresAt: inMinutes(20) })],
    });
    expect(items.some((i) => i.kind === "invoice-missing")).toBe(false);
  });

  it("keeps abandoned checkouts quiet and last", () => {
    const items = run({
      orphanOrders: [
        { uid: "a1", bookerName: "X", amountTotal: 30000, currency: "EUR", stripePaymentId: null },
        { uid: "a2", bookerName: "Y", amountTotal: 30000, currency: "EUR", stripePaymentId: null },
      ],
      bookings: [room({ orderUid: "o3", invoiceNumber: null })],
    });
    expect(items.map((i) => i.kind)).toEqual(["invoice-missing", "abandoned"]);
    expect(items[1].title).toBe("2 abandoned checkouts took no money");
  });

  it("treats a configuration error as critical and a warning as a warning", () => {
    const items = run({
      configIssues: [
        { key: "A", level: "warning", title: "w", detail: "" },
        { key: "B", level: "error", title: "e", detail: "" },
      ],
    });
    expect(items.map((i) => i.severity)).toEqual(["critical", "warning"]);
  });

  it("counts only what is not informational for the navigation badge", () => {
    const items = run({
      orphanOrders: [{ uid: "a1", bookerName: "X", amountTotal: 1, currency: "EUR", stripePaymentId: null }],
      bookings: [room({ orderUid: "o4", invoiceNumber: null })],
    });
    expect(attentionCount(items)).toBe(1);
  });
});
