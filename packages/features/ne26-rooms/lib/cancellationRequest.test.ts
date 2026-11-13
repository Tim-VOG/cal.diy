import { describe, expect, it } from "vitest";
import {
  canRequestCancellation,
  cancellationRequestNotification,
  requestRefusalMessage,
} from "./cancellationRequest";

const BOOKING = {
  status: "CONFIRMED",
  creditNoteId: null,
  bookerCancelledAt: null,
  cancellationRequestedAt: null,
};

const NOTE_INPUT = {
  roomLabel: "Meeting 3 (Large Room 1)",
  slotLabel: "Tue 17 Nov, 12:15–15:15",
  bookerName: "Jean Dupont",
  bookerEmail: "jean@example.test",
  company: "Deloitte Belgium",
  takenBy: "Zeynep",
  note: null,
  orderUrl: "https://rooms.vo-eu.be/rooms/admin/order/abc",
  orderRef: "NE26-ORD-0038",
};

describe("who may ask the desk to cancel", () => {
  it("takes the ask for a paid room", () => {
    expect(canRequestCancellation(BOOKING)).toEqual({ allowed: true });
  });

  it("refuses an unpaid hold, which frees itself anyway", () => {
    expect(canRequestCancellation({ ...BOOKING, status: "PENDING" })).toEqual({
      allowed: false,
      reason: "not-confirmed",
    });
  });

  it("refuses a room already credited or already refunded", () => {
    expect(canRequestCancellation({ ...BOOKING, creditNoteId: 4 }).allowed).toBe(false);
    expect(canRequestCancellation({ ...BOOKING, bookerCancelledAt: new Date() }).allowed).toBe(false);
  });

  it("takes the ask once, not twice", () => {
    // Two mails about one room leave the desk unable to tell whether the first
    // was seen.
    expect(canRequestCancellation({ ...BOOKING, cancellationRequestedAt: new Date() })).toEqual({
      allowed: false,
      reason: "already-requested",
    });
  });

  it("says why, in words a hostess can read out", () => {
    expect(requestRefusalMessage("already-requested")).toContain("Sales have it");
    expect(requestRefusalMessage("not-confirmed")).toContain("frees itself");
  });
});

describe("what sales are told", () => {
  it("names the room and the day in the subject", () => {
    const mail = cancellationRequestNotification(NOTE_INPUT);
    expect(mail.subject).toBe(
      "Cancellation asked at the desk — Meeting 3 (Large Room 1), Tue 17 Nov, 12:15–15:15"
    );
  });

  it("says plainly that nothing has moved", () => {
    // The whole point of the desk's version: an ask, not an act.
    const mail = cancellationRequestNotification(NOTE_INPUT);
    expect(mail.body).toContain("Nothing has been cancelled and nothing has been refunded");
    expect(mail.html).toContain("Nothing has been cancelled and nothing has been refunded");
  });

  it("carries the hostess who took it and a link to decide", () => {
    const mail = cancellationRequestNotification(NOTE_INPUT);
    expect(mail.body).toContain("Zeynep");
    expect(mail.body).toContain("https://rooms.vo-eu.be/rooms/admin/order/abc");
  });

  it("quotes what the exhibitor said, when they said something", () => {
    const withNote = cancellationRequestNotification({ ...NOTE_INPUT, note: "Flight cancelled" });
    expect(withNote.body).toContain("Flight cancelled");
    expect(cancellationRequestNotification(NOTE_INPUT).body).not.toContain("Said:");
  });

  it("escapes what someone typed rather than letting it into the markup", () => {
    const mail = cancellationRequestNotification({ ...NOTE_INPUT, note: "<script>alert(1)</script>" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
