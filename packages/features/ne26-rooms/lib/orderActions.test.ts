import { describe, expect, it } from "vitest";
import { availableOrderActions, hasNoActions, type OrderState } from "./orderActions";

const order = (over: Partial<OrderState> = {}): OrderState => ({
  status: "PENDING",
  hasInvoice: false,
  hasCreditNote: false,
  roomCount: 1,
  ...over,
});

describe("an order that still holds rooms", () => {
  it("can be confirmed by hand or cancelled while it is pending", () => {
    const a = availableOrderActions(order());
    expect(a.confirmManually).toBe(true);
    expect(a.cancelPending).toBe(true);
    expect(a.closeSettled).toBe(false);
  });

  it("can have a missing invoice issued once it is confirmed", () => {
    expect(availableOrderActions(order({ status: "CONFIRMED" })).issueInvoice).toBe(true);
  });

  it("can be credited once it has an invoice", () => {
    const a = availableOrderActions(order({ status: "CONFIRMED", hasInvoice: true }));
    expect(a.issueCreditNote).toBe(true);
    expect(a.issueInvoice).toBe(false);
  });

  it("cannot be credited twice", () => {
    const a = availableOrderActions(
      order({ status: "CONFIRMED", hasInvoice: true, hasCreditNote: true })
    );
    expect(a.issueCreditNote).toBe(false);
  });
});

describe("an order that holds no rooms", () => {
  const roomless = (over: Partial<OrderState> = {}) => availableOrderActions(order({ roomCount: 0, ...over }));

  it("is closable while pending, and that is the only thing on offer", () => {
    const a = roomless();
    expect(a.closeSettled).toBe(true);
    expect(a.confirmManually).toBe(false);
    expect(a.cancelPending).toBe(false);
    expect(a.issueInvoice).toBe(false);
  });

  it("is never offered an invoice", () => {
    // The one that would cost real money: an invoice listing no rooms, with a
    // document number spent on it, in a gapless series.
    for (const status of ["PENDING", "CONFIRMED", "CANCELLED"]) {
      expect(roomless({ status }).issueInvoice, status).toBe(false);
    }
  });

  it("is never offered a manual confirmation", () => {
    // confirmPaid refuses to record a sale with no rooms, so the button could
    // only ever fail in the admin's face.
    expect(roomless().confirmManually).toBe(false);
  });

  it("can still have its paperwork re-sent, and credited if it was invoiced", () => {
    const credited = roomless({ status: "CONFIRMED", hasInvoice: true });
    expect(credited.resendInvoice).toBe(true);
    expect(credited.issueCreditNote).toBe(true);
  });

  it("offers nothing at all once it is closed", () => {
    expect(hasNoActions(roomless({ status: "CANCELLED" }))).toBe(true);
  });
});

describe("closing is never offered where it would strand a room", () => {
  it("is refused for every state that still holds one", () => {
    for (const status of ["PENDING", "CONFIRMED", "CANCELLED"]) {
      for (const roomCount of [1, 2, 3]) {
        expect(availableOrderActions(order({ status, roomCount })).closeSettled, `${status}/${roomCount}`).toBe(
          false
        );
      }
    }
  });

  it("is refused for an order that was already paid and confirmed", () => {
    // Confirmed means the money is recorded. If it has an invoice it has to be
    // credited, not quietly cancelled; the repository refuses this too.
    expect(availableOrderActions(order({ status: "CONFIRMED", roomCount: 0 })).closeSettled).toBe(false);
  });
});

describe("every combination stays coherent", () => {
  it("never offers two ways to end the same order at once", () => {
    for (const status of ["PENDING", "CONFIRMED", "CANCELLED"]) {
      for (const roomCount of [0, 1, 2]) {
        for (const hasInvoice of [true, false]) {
          for (const hasCreditNote of [true, false]) {
            const a = availableOrderActions({ status, roomCount, hasInvoice, hasCreditNote });
            const endings = [a.cancelPending, a.closeSettled, a.issueCreditNote].filter(Boolean).length;
            expect(endings, `${status}/${roomCount}/${hasInvoice}/${hasCreditNote}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
