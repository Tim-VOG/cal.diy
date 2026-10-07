import { describe, expect, it } from "vitest";
import { buildEventSchedule } from "./eventSchedule";
import { canBookerCancel, cancellationDeadline, refusalMessage } from "./cancellationPolicy";

const SCHEDULE = buildEventSchedule([
  { date: "2026-11-17", openHour: 9, closeHour: 17 },
  { date: "2026-11-18", openHour: 9, closeHour: 17 },
]);
const DEADLINE = cancellationDeadline(SCHEDULE);

const BOOKING = {
  status: "CONFIRMED",
  creditNoteId: null,
  bookerCancelledAt: null,
  order: { status: "CONFIRMED", stripePaymentId: "pi_1", invoiceNumber: "NE26-2026-0001" },
};
const BEFORE = new Date("2026-11-09T12:00:00.000Z");

describe("cancellationDeadline", () => {
  it("closes seven days before the first bookable minute", () => {
    // The event opens Tue 17 Nov at 09:00 TRT, which is 06:00 UTC.
    expect(DEADLINE?.toISOString()).toBe("2026-11-10T06:00:00.000Z");
  });

  it("has no deadline when no day is open", () => {
    expect(cancellationDeadline([])).toBeNull();
  });
});

describe("canBookerCancel", () => {
  it("lets a paid room go before the deadline", () => {
    expect(canBookerCancel(BOOKING, BEFORE, DEADLINE)).toEqual({ allowed: true });
  });

  it("closes at the deadline, to the second", () => {
    expect(canBookerCancel(BOOKING, new Date(DEADLINE!.getTime() - 1), DEADLINE).allowed).toBe(true);
    expect(canBookerCancel(BOOKING, DEADLINE!, DEADLINE)).toEqual({
      allowed: false,
      reason: "deadline-passed",
    });
  });

  it("refuses a room already credited, or one whose refund is in flight", () => {
    expect(canBookerCancel({ ...BOOKING, creditNoteId: 4 }, BEFORE, DEADLINE)).toEqual({
      allowed: false,
      reason: "already-cancelled",
    });
    // Claimed before the refund is sent: a second click must not pay out twice.
    expect(canBookerCancel({ ...BOOKING, bookerCancelledAt: BEFORE }, BEFORE, DEADLINE)).toEqual({
      allowed: false,
      reason: "already-cancelled",
    });
  });

  it("refuses anything not paid, and anything not paid by card", () => {
    expect(canBookerCancel({ ...BOOKING, status: "PENDING" }, BEFORE, DEADLINE)).toEqual({
      allowed: false,
      reason: "not-confirmed",
    });
    expect(
      canBookerCancel({ ...BOOKING, order: { ...BOOKING.order, status: "CANCELLED" } }, BEFORE, DEADLINE)
    ).toEqual({ allowed: false, reason: "not-confirmed" });
    // A bank transfer has no card to give back; the desk refunds it by hand.
    expect(
      canBookerCancel({ ...BOOKING, order: { ...BOOKING.order, stripePaymentId: null } }, BEFORE, DEADLINE)
    ).toEqual({ allowed: false, reason: "no-card-payment" });
  });

  it("refuses a paid room whose invoice never came out", () => {
    // Refunding first would put money out with no document to cancel.
    expect(
      canBookerCancel({ ...BOOKING, order: { ...BOOKING.order, invoiceNumber: null } }, BEFORE, DEADLINE)
    ).toEqual({ allowed: false, reason: "no-invoice" });
  });

  it("takes the earliest day, however the days are ordered", () => {
    const outOfOrder = cancellationDeadline([
      { openSlotStartsUtc: [new Date("2026-11-19T06:00:00.000Z")] },
      { openSlotStartsUtc: [new Date("2026-11-17T06:00:00.000Z")] },
    ]);
    expect(outOfOrder?.toISOString()).toBe("2026-11-10T06:00:00.000Z");
  });

  it("names the inbox to write to when it refuses", () => {
    expect(refusalMessage("deadline-passed", "sales@example.com")).toContain("sales@example.com");
    expect(refusalMessage("no-card-payment", "sales@example.com")).toContain("sales@example.com");
  });
});
