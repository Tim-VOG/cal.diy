import { AddOnPriceType } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import {
  canTopUp,
  checkTopUpCovers,
  coverRefusalMessage,
  topUpRefusalMessage,
  type TopUppableBooking,
} from "./cateringTopUp";

/** 17 Nov 2026, 10:00 in Izmir (UTC+3). */
const BOOKING_START = new Date("2026-11-17T07:00:00.000Z");

const paidRoom: TopUppableBooking = {
  status: "CONFIRMED",
  startTime: BOOKING_START,
  creditNoteId: null,
  bookerCancelledAt: null,
  isBlock: false,
  order: { status: "CONFIRMED" },
};

describe("canTopUp", () => {
  it("allows a paid room while catering is on sale", () => {
    expect(canTopUp(paidRoom, { salesOpen: true })).toEqual({ allowed: true });
  });

  it("refuses every room once the switch is closed, however far off the booking is", () => {
    expect(canTopUp(paidRoom, { salesOpen: false })).toEqual({
      allowed: false,
      reason: "sales-closed",
    });
  });

  it("refuses a room that has not been paid for", () => {
    expect(canTopUp({ ...paidRoom, status: "PENDING" }, { salesOpen: true })).toEqual({
      allowed: false,
      reason: "not-confirmed",
    });
  });

  it("refuses a confirmed room whose order is still pending", () => {
    expect(canTopUp({ ...paidRoom, order: { status: "PENDING" } }, { salesOpen: true })).toEqual({
      allowed: false,
      reason: "not-confirmed",
    });
  });

  it("refuses a credited room", () => {
    expect(canTopUp({ ...paidRoom, creditNoteId: 7 }, { salesOpen: true })).toEqual({
      allowed: false,
      reason: "already-cancelled",
    });
  });

  it("refuses a room whose refund is in flight, before the credit note exists", () => {
    expect(canTopUp({ ...paidRoom, bookerCancelledAt: new Date() }, { salesOpen: true })).toEqual({
      allowed: false,
      reason: "already-cancelled",
    });
  });

  it("refuses an admin block, which is not a sale at all", () => {
    expect(canTopUp({ ...paidRoom, isBlock: true }, { salesOpen: true })).toEqual({
      allowed: false,
      reason: "not-confirmed",
    });
  });

  it("tells a cancelled room it is cancelled, even with the switch closed", () => {
    // The switch is the last check, so the exhibitor reads the more useful of
    // the two reasons rather than one that sends them to the organiser.
    expect(canTopUp({ ...paidRoom, creditNoteId: 7 }, { salesOpen: false })).toEqual({
      allowed: false,
      reason: "already-cancelled",
    });
  });
});

describe("topUpRefusalMessage", () => {
  const contactEmail = "rooms@example.test";

  it("says the room is untouched when catering is closed", () => {
    const message = topUpRefusalMessage("sales-closed", { contactEmail });
    expect(message).toContain("no longer on sale");
    expect(message).toContain("room itself is unaffected");
    expect(message).toContain(contactEmail);
  });

  it("never quotes a deadline, because there is no longer a clock to quote", () => {
    for (const reason of ["sales-closed", "not-confirmed", "already-cancelled"] as const) {
      expect(topUpRefusalMessage(reason, { contactEmail })).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});

describe("checkTopUpCovers", () => {
  const lunch = {
    priceType: AddOnPriceType.PER_PERSON,
    addOnId: 1,
    existing: [{ addOnId: 1, quantity: 6 }],
    roomCapacity: 8,
    roomCategory: "ENTRY",
  };

  it("counts covers already ordered against the room's capacity", () => {
    expect(checkTopUpCovers({ ...lunch, requested: 2 })).toEqual({ ok: true });
    expect(checkTopUpCovers({ ...lunch, requested: 3 })).toEqual({
      ok: false,
      refusal: { kind: "over-capacity", capacity: 8, alreadyOrdered: 6 },
    });
  });

  it("lets a small top-up through, because the minimum is about the total", () => {
    // Two extra covers on top of six is not a table of two: the caterer's
    // minimum of four is already met by the order as a whole.
    expect(checkTopUpCovers({ ...lunch, requested: 2 })).toEqual({ ok: true });
  });

  it("still applies the minimum to a product ordered for the first time", () => {
    expect(checkTopUpCovers({ ...lunch, existing: [], requested: 2 })).toEqual({
      ok: false,
      refusal: { kind: "under-minimum", minimum: 4, total: 2 },
    });
  });

  it("counts only the same product, not every cover in the room", () => {
    expect(
      checkTopUpCovers({
        ...lunch,
        existing: [{ addOnId: 2, quantity: 8 }],
        requested: 6,
      })
    ).toEqual({ ok: true });
  });

  it("sums several lines of the same product, bought on different orders", () => {
    expect(
      checkTopUpCovers({
        ...lunch,
        existing: [
          { addOnId: 1, quantity: 4 },
          { addOnId: 1, quantity: 3 },
        ],
        requested: 2,
      })
    ).toEqual({
      ok: false,
      refusal: { kind: "over-capacity", capacity: 8, alreadyOrdered: 7 },
    });
  });

  it("holds a premium room to its higher minimum", () => {
    expect(
      checkTopUpCovers({ ...lunch, roomCategory: "PREMIUM", roomCapacity: 20, existing: [], requested: 5 })
    ).toEqual({ ok: false, refusal: { kind: "under-minimum", minimum: 6, total: 5 } });
  });

  it("leaves per-hour and flat add-ons alone", () => {
    expect(checkTopUpCovers({ ...lunch, priceType: AddOnPriceType.PER_HOUR, requested: 99 })).toEqual({
      ok: true,
    });
    expect(checkTopUpCovers({ ...lunch, priceType: AddOnPriceType.FLAT, requested: 99 })).toEqual({
      ok: true,
    });
  });

  it("says how many more covers are left, rather than just refusing", () => {
    expect(coverRefusalMessage("Lunch", { kind: "over-capacity", capacity: 8, alreadyOrdered: 6 })).toContain(
      "you can add 2 more"
    );
  });
});
