import { describe, expect, it, vi } from "vitest";
import {
  REMINDER_LEAD_MINUTES,
  holdExpiryLabel,
  minutesUntil,
  remindExpiringHolds,
  roomLabelFor,
} from "./HoldReminderService";

const NOW = new Date("2026-11-18T09:00:00.000Z");

function order(overrides: Partial<Parameters<typeof makeOrder>[0]> = {}) {
  return makeOrder({ minutesLeft: 10, ...overrides });
}
function makeOrder(o: { minutesLeft: number; uid?: string; email?: string | null }) {
  return {
    uid: o.uid ?? "order-1",
    bookerName: "Jane Exhibitor",
    bookerEmail: (o.email === undefined ? "jane@example.com" : o.email) as string,
    holdExpiresAt: new Date(NOW.getTime() + o.minutesLeft * 60_000),
    bookings: [
      {
        startTime: new Date("2026-11-18T11:00:00.000Z"),
        endTime: new Date("2026-11-18T12:00:00.000Z"),
        resource: { name: "Suite 1" },
      },
    ],
  };
}

function deps(due: ReturnType<typeof order>[], claim = true) {
  return {
    findHoldsExpiringSoon: vi.fn().mockResolvedValue(due),
    claimHoldReminder: vi.fn().mockResolvedValue(claim),
    sendReminder: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  };
}

describe("holdExpiryLabel", () => {
  it("reads as an event-local wall clock", () => {
    // 09:35 UTC is 12:35 in Izmir, which is the time the buyer sees on the site.
    expect(holdExpiryLabel(new Date("2026-11-18T09:35:00.000Z"))).toBe("12:35");
  });
});

describe("minutesUntil", () => {
  it("rounds up, so a hold with forty seconds left is not '0 minutes'", () => {
    expect(minutesUntil(new Date(NOW.getTime() + 40_000), NOW)).toBe(1);
  });

  it("never goes negative", () => {
    expect(minutesUntil(new Date(NOW.getTime() - 60_000), NOW)).toBe(0);
  });
});

describe("roomLabelFor", () => {
  it("names one room and counts the rest", () => {
    expect(roomLabelFor([{ resource: { name: "Suite 1" } }])).toBe("Suite 1");
    expect(roomLabelFor([{ resource: { name: "Suite 1" } }, { resource: { name: "Studio 3" } }])).toBe(
      "Suite 1 + 1 more"
    );
  });

  it("does not print an empty name when an order somehow has no rooms", () => {
    expect(roomLabelFor([])).toBe("your meeting room");
  });
});

describe("remindExpiringHolds", () => {
  it("looks only at the next quarter of an hour, and not into the past", async () => {
    const d = deps([]);
    await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");

    const [from, before] = d.findHoldsExpiringSoon.mock.calls[0];
    expect(from).toEqual(NOW);
    expect((before.getTime() - NOW.getTime()) / 60000).toBe(REMINDER_LEAD_MINUTES);
  });

  it("warns the buyer with the time left and where to pay", async () => {
    const d = deps([order({ minutesLeft: 12 })]);
    const { sent } = await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(1);
    expect(d.sendReminder).toHaveBeenCalledTimes(1);
    expect(d.sendReminder.mock.calls[0][0]).toMatchObject({
      to: "jane@example.com",
      roomName: "Suite 1",
      minutesLeft: 12,
      expiresAtLabel: "12:12",
      kind: "expiring",
      payUrl: "https://rooms.vo-eu.be/rooms/bookings",
    });
  });

  it("claims the reminder BEFORE sending, so overlapping runs cannot double-mail", async () => {
    const d = deps([order()]);
    await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");

    const claimOrder = d.claimHoldReminder.mock.invocationCallOrder[0];
    const sendOrder = d.sendReminder.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);
  });

  it("sends nothing when another run already claimed it", async () => {
    const d = deps([order()], false);
    const { sent } = await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(0);
    expect(d.sendReminder).not.toHaveBeenCalled();
  });

  it("skips an order with no address rather than claiming it", async () => {
    // Claiming would mark it reminded and silently swallow the buyer forever.
    const d = deps([makeOrder({ minutesLeft: 10, email: null })]);
    await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");

    expect(d.claimHoldReminder).not.toHaveBeenCalled();
    expect(d.sendReminder).not.toHaveBeenCalled();
  });

  it("keeps going when one address fails", async () => {
    // A single bad address must not deny every other buyer their warning.
    const d = deps([makeOrder({ minutesLeft: 10, uid: "a" }), makeOrder({ minutesLeft: 9, uid: "b" })]);
    d.sendReminder.mockRejectedValueOnce(new Error("mailbox full"));

    const { sent } = await remindExpiringHolds(d, NOW, "https://rooms.vo-eu.be");
    expect(sent).toBe(1);
    expect(d.onError).toHaveBeenCalledTimes(1);
    expect(d.onError.mock.calls[0][0]).toBe("a");
  });
});
