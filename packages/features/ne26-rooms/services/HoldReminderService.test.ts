import { describe, expect, it, vi } from "vitest";
import {
  OPENING_NOTICE_DELAY_MINUTES,
  REMINDER_LEAD_MINUTES,
  holdExpiryLabel,
  minutesUntil,
  roomLabelFor,
  runHoldNotices,
} from "./HoldReminderService";

const NOW = new Date("2026-11-18T09:00:00.000Z");

function order(overrides: Partial<Parameters<typeof makeOrder>[0]> = {}) {
  return makeOrder({ minutesLeft: 10, ...overrides });
}
function makeOrder(o: {
  minutesLeft: number;
  uid?: string;
  email?: string | null;
  /** When this buyer was last written to about this hold. */
  notifiedAt?: Date | null;
}) {
  return {
    uid: o.uid ?? "order-1",
    bookerName: "Jane Exhibitor",
    bookerEmail: (o.email === undefined ? "jane@example.com" : o.email) as string,
    holdExpiresAt: new Date(NOW.getTime() + o.minutesLeft * 60_000),
    holdReminderSentAt: o.notifiedAt ?? null,
    bookings: [
      {
        startTime: new Date("2026-11-18T11:00:00.000Z"),
        endTime: new Date("2026-11-18T12:00:00.000Z"),
        resource: { name: "Suite 1" },
      },
    ],
  };
}

function deps(due: ReturnType<typeof order>[], claim = true, opened: ReturnType<typeof order>[] = []) {
  return {
    findHoldsExpiringSoon: vi.fn().mockResolvedValue(due),
    findHoldsOpenedBefore: vi.fn().mockResolvedValue(opened),
    claimHoldNotice: vi.fn().mockResolvedValue(claim),
    sendReminder: vi.fn().mockResolvedValue(undefined),
    onError: vi.fn(),
  };
}

describe("holdExpiryLabel", () => {
  it("names the zone it is telling the time in", () => {
    // 09:35 UTC is 12:35 in Izmir. Unlabelled, that read as 12:35 to a buyer in
    // Brussels whose hold actually lapsed at 10:35 their time — an hour of
    // false confidence on a countdown with money at the end of it. This is the
    // one clock in the product that runs today rather than at the event, so it
    // has to say which clock it is.
    expect(holdExpiryLabel(new Date("2026-11-18T09:35:00.000Z"))).toBe("12:35 TRT");
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

describe("the warning before a hold lapses", () => {
  it("looks only at the next quarter of an hour, and not into the past", async () => {
    const d = deps([]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    const [from, before] = d.findHoldsExpiringSoon.mock.calls[0];
    expect(from).toEqual(NOW);
    expect((before.getTime() - NOW.getTime()) / 60000).toBe(REMINDER_LEAD_MINUTES);
  });

  it("warns the buyer with the time left and where to pay", async () => {
    const d = deps([order({ minutesLeft: 12 })]);
    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(1);
    expect(d.sendReminder).toHaveBeenCalledTimes(1);
    expect(d.sendReminder.mock.calls[0][0]).toMatchObject({
      to: "jane@example.com",
      roomName: "Suite 1",
      minutesLeft: 12,
      expiresAtLabel: "12:12 TRT",
      kind: "expiring",
      payUrl: "https://rooms.vo-eu.be/rooms/bookings",
    });
  });

  it("claims the reminder BEFORE sending, so overlapping runs cannot double-mail", async () => {
    const d = deps([order()]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    const claimOrder = d.claimHoldNotice.mock.invocationCallOrder[0];
    const sendOrder = d.sendReminder.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(sendOrder);
  });

  it("sends nothing when another run already claimed it", async () => {
    const d = deps([order()], false);
    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(0);
    expect(d.sendReminder).not.toHaveBeenCalled();
  });

  it("skips an order with no address rather than claiming it", async () => {
    // Claiming would mark it reminded and silently swallow the buyer forever.
    const d = deps([makeOrder({ minutesLeft: 10, email: null })]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(d.claimHoldNotice).not.toHaveBeenCalled();
    expect(d.sendReminder).not.toHaveBeenCalled();
  });

  it("keeps going when one address fails", async () => {
    // A single bad address must not deny every other buyer their warning.
    const d = deps([makeOrder({ minutesLeft: 10, uid: "a" }), makeOrder({ minutesLeft: 9, uid: "b" })]);
    d.sendReminder.mockRejectedValueOnce(new Error("mailbox full"));

    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");
    expect(sent).toBe(1);
    expect(d.onError).toHaveBeenCalledTimes(1);
    expect(d.onError.mock.calls[0][0]).toBe("a");
  });
});

/**
 * The opening notice used to be sent the instant the rooms were held — while
 * the buyer was being redirected to Stripe, or a minute before they paid. It
 * now waits, which is also what lets it state the time actually left.
 */
describe("the opening notice", () => {
  it("looks back by the delay, and ignores holds that have already lapsed", async () => {
    const d = deps([]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    const [cutoff, now] = d.findHoldsOpenedBefore.mock.calls[0];
    expect((NOW.getTime() - cutoff.getTime()) / 60000).toBe(OPENING_NOTICE_DELAY_MINUTES);
    expect(now).toEqual(NOW);
  });

  it("says how long is really left, not how long the hold was", async () => {
    // Eight of the thirty-five minutes are gone by the time it goes out. A mail
    // promising thirty-five would be wrong by the width of its own delay.
    const d = deps([], true, [order({ minutesLeft: 27 })]);
    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(1);
    expect(d.sendReminder.mock.calls[0][0]).toMatchObject({
      kind: "created",
      minutesLeft: 27,
      expiresAtLabel: "12:27 TRT",
    });
  });

  it("claims with no floor, so it can only ever be the first message", async () => {
    const d = deps([], true, [order({ minutesLeft: 27 })]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(d.claimHoldNotice.mock.calls[0][2]).toBeNull();
  });
});

describe("the two messages one hold earns", () => {
  it("still warns a buyer who already had the opening notice", async () => {
    // The opening one was sent well before the final quarter of an hour, so the
    // warning is still owed. This is the whole point of the two-stage claim.
    const openedLongAgo = new Date(NOW.getTime() - 20 * 60_000);
    const d = deps([order({ minutesLeft: 12, notifiedAt: openedLongAgo })]);

    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(1);
    expect(d.sendReminder.mock.calls[0][0]).toMatchObject({ kind: "expiring" });
  });

  it("does not warn twice", async () => {
    // A message sent once the hold was already inside its final quarter of an
    // hour WAS the warning.
    const alreadyWarned = new Date(NOW.getTime() - 60_000);
    const d = deps([order({ minutesLeft: 12, notifiedAt: alreadyWarned })]);

    const { sent } = await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(sent).toBe(0);
    expect(d.claimHoldNotice).not.toHaveBeenCalled();
  });

  it("claims the warning against the moment the hold entered its last stretch", async () => {
    const d = deps([order({ minutesLeft: 12, notifiedAt: new Date(NOW.getTime() - 20 * 60_000) })]);
    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    const expiry = NOW.getTime() + 12 * 60_000;
    const floor = d.claimHoldNotice.mock.calls[0][2] as Date;
    expect((expiry - floor.getTime()) / 60000).toBe(REMINDER_LEAD_MINUTES);
  });

  it("tells a buyer a clock exists before telling them it is nearly up", async () => {
    // Both fall due in one pass on a hold taken shortly before it lapses.
    // "Fifteen minutes left" arriving first would be the first they had heard
    // of any of it.
    const one = order({ minutesLeft: 12, uid: "same" });
    const d = deps([one], true, [one]);

    await runHoldNotices(d, NOW, "https://rooms.vo-eu.be");

    expect(d.sendReminder.mock.calls[0][0].kind).toBe("created");
    expect(d.sendReminder.mock.calls[1][0].kind).toBe("expiring");
  });
});
