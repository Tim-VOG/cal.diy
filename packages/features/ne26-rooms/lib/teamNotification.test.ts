import { describe, expect, it } from "vitest";
import { formatMoney, saleNotification } from "./teamNotification";

const SUITE_1 = {
  roomName: "Suite 1",
  startUtc: new Date("2026-11-17T13:00:00.000Z"),
  endUtc: new Date("2026-11-17T15:00:00.000Z"),
  durationMinutes: 120,
  addOns: [{ name: "Catering - Lunch", quantity: 2, lineTotal: 14000 }],
};

const BASE = {
  orderUid: "2fe0f775-7681-4cb1-a0c3-b21dac06219d",
  rooms: [SUITE_1],
  bookerName: "Jane Exhibitor",
  bookerEmail: "jane@example.com",
  bookerCountry: "FR",
  bookerVatNumber: "FR12345678901",
  amountHt: 72000,
  amountPaid: 87120,
  currency: "EUR",
  invoiceNumber: "NE26-2026-0007",
  adminUrl: "https://rooms.vo-eu.be/rooms/admin",
};

describe("formatMoney", () => {
  it("converts minor units to a human amount", () => {
    // The sales team was told a 871.20 EUR booking was "87120 EUR".
    expect(formatMoney(87120, "EUR")).toBe("871.20 EUR");
  });

  it("keeps trailing zeros so amounts line up", () => {
    expect(formatMoney(72000, "eur")).toBe("720.00 EUR");
    expect(formatMoney(0, "EUR")).toBe("0.00 EUR");
  });
});

describe("saleNotification", () => {
  it("never prints a raw minor-unit amount", () => {
    const { subject, body } = saleNotification(BASE);
    expect(subject).not.toContain("87120");
    expect(body).not.toContain("87120");
    expect(body).not.toContain("72000");
    expect(body).not.toContain("14000");
  });

  it("names the room, the duration and the amount paid in the subject", () => {
    expect(saleNotification(BASE).subject).toBe("Room sold — Suite 1, 2h (871.20 EUR)");
  });

  it("reports both the excl.-VAT order total and what Stripe captured", () => {
    const { body } = saleNotification(BASE);
    expect(body).toContain("720.00 EUR");
    expect(body).toContain("871.20 EUR");
  });

  it("carries the slot in the event's local time, not UTC", () => {
    // Istanbul is UTC+3 all year, so 13:00 UTC is 16:00 locally.
    expect(saleNotification(BASE).body).toContain("Tue, 17 Nov 2026, 16:00-18:00 (Europe/Istanbul)");
  });

  it("gives a clickable admin link, not a bare path", () => {
    expect(saleNotification(BASE).body).toContain("https://rooms.vo-eu.be/rooms/admin");
  });

  it("lists the add-ons with their quantities", () => {
    expect(saleNotification(BASE).body).toContain("Catering - Lunch x 2 — 140.00 EUR");
  });

  it("still reads correctly with no add-ons, no VAT number and no invoice yet", () => {
    const { subject, body } = saleNotification({
      ...BASE,
      rooms: [{ ...SUITE_1, addOns: [] }],
      bookerVatNumber: null,
      bookerCountry: null,
      invoiceNumber: null,
      amountPaid: null,
    });
    expect(subject).toBe("Room sold — Suite 1, 2h");
    expect(body).not.toContain("Catering");
    expect(body).not.toContain("Invoice:");
    expect(body).toContain("720.00 EUR");
  });

  it("falls back to a neutral buyer label rather than printing 'null'", () => {
    const { body } = saleNotification({ ...BASE, bookerName: null, bookerEmail: null });
    expect(body).toContain("An exhibitor");
    expect(body).not.toContain("null");
  });

  describe("an order covering several rooms", () => {
    const MULTI = {
      ...BASE,
      rooms: [
        SUITE_1,
        {
          roomName: "Studio 3",
          startUtc: new Date("2026-11-18T07:00:00.000Z"),
          endUtc: new Date("2026-11-18T08:00:00.000Z"),
          durationMinutes: 60,
          addOns: [],
        },
      ],
      amountHt: 102000,
      amountPaid: 123420,
    };

    it("counts the rooms in the subject instead of naming them all", () => {
      // Naming three rooms would run past what any mail client shows.
      expect(saleNotification(MULTI).subject).toBe("Room sold — 2 rooms (1234.20 EUR)");
    });

    it("lists every room with its own slot in the body", () => {
      const { body } = saleNotification(MULTI);
      expect(body).toContain("Suite 1 — 2h");
      expect(body).toContain("Tue, 17 Nov 2026, 16:00-18:00 (Europe/Istanbul)");
      expect(body).toContain("Studio 3 — 1h");
      expect(body).toContain("Wed, 18 Nov 2026, 10:00-11:00 (Europe/Istanbul)");
    });

    it("reports one total for the whole order, not one per room", () => {
      const { body } = saleNotification(MULTI);
      expect(body).toContain("1020.00 EUR");
      expect(body).toContain("1234.20 EUR");
      // The single order reference is what ties the payment to the invoice.
      expect(body).toContain(BASE.orderUid);
    });

    it("attaches each add-on to the room it belongs to", () => {
      // Add-ons were printed in one flat list, so a lunch ordered for Suite 1
      // read as if it belonged to Studio 3.
      const body = saleNotification(MULTI).body;
      const suiteAt = body.indexOf("Suite 1 — 2h");
      const cateringAt = body.indexOf("Catering - Lunch");
      const studioAt = body.indexOf("Studio 3 — 1h");
      expect(cateringAt).toBeGreaterThan(suiteAt);
      expect(cateringAt).toBeLessThan(studioAt);
    });
  });
});
