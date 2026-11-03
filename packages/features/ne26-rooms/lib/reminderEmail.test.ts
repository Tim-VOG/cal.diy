import { describe, expect, it } from "vitest";
import { buildReminderEmail, reminderSubject, type ReminderRoom } from "./reminderEmail";

const meeting1: ReminderRoom = {
  doorName: "Meeting 1",
  soldName: "Small Room 1",
  slotLabel: "Tue 17 Nov, 10:00–11:00",
  addOns: [{ name: "Lunch", quantity: 6 }],
};

const suite1: ReminderRoom = {
  doorName: "Suite 1",
  soldName: null,
  slotLabel: "Wed 18 Nov, 09:00–11:00",
  addOns: [],
};

const base = {
  bookerName: "Maria",
  bookingsUrl: "https://rooms.vo-eu.be/rooms/bookings",
  contactEmail: "Sales-NatoEdge@vo-europe.eu",
};

describe("the reminder mail", () => {
  it("leads with the door and keeps the bought name under it", () => {
    const mail = buildReminderEmail({ ...base, rooms: [meeting1] });
    expect(mail.html).toContain("Meeting 1");
    expect(mail.html).toContain("Booked as Small Room 1");
    expect(mail.text).toContain("Meeting 1");
    expect(mail.text).toContain("Booked as Small Room 1");
  });

  it("says nothing extra for a room called the same on both sides", () => {
    // A suite is called the same thing on the door and on the invoice, so
    // there is no second name to show and nothing to reassure anybody about.
    const mail = buildReminderEmail({ ...base, rooms: [suite1] });
    expect(mail.html).toContain("Suite 1");
    expect(mail.html).not.toContain("Booked as");
    expect(mail.text).not.toContain("Booked as");
  });

  it("pairs the names room by room when a booking mixes the two kinds", () => {
    const mail = buildReminderEmail({ ...base, rooms: [meeting1, suite1] });
    expect(mail.html.match(/Booked as/g)).toHaveLength(1);
    expect(mail.html).toContain("Meeting 1");
    expect(mail.html).toContain("Suite 1");
  });

  it("carries no paragraph of explanation, only the two names", () => {
    // The pairing is the explanation. Prose about it made a simple thing read
    // like a problem, so it was cut.
    const mail = buildReminderEmail({ ...base, rooms: [meeting1] });
    expect(mail.html).not.toContain("signposted Meeting 1 to");
    expect(mail.html).not.toContain("Türkiye time");
    expect(mail.text).not.toContain("welcome desk");
  });

  it("names what was already paid for, so nobody has to ask", () => {
    expect(buildReminderEmail({ ...base, rooms: [meeting1] }).html).toContain("Lunch × 6");
    expect(buildReminderEmail({ ...base, rooms: [suite1] }).html).not.toContain("Included:");
  });

  it("puts the door in the subject of a one-room booking", () => {
    expect(reminderSubject([meeting1])).toBe("Your NATO Edge 26 room is signposted Meeting 1");
    expect(reminderSubject([suite1])).toBe("Where to find your NATO Edge 26 room — Suite 1");
    expect(reminderSubject([meeting1, suite1])).toBe("Where to find your NATO Edge 26 meeting rooms");
  });

  it("speaks of one booking or several, never both at once", () => {
    expect(buildReminderEmail({ ...base, rooms: [meeting1] }).text).toContain("your booking at");
    expect(buildReminderEmail({ ...base, rooms: [meeting1, suite1] }).text).toContain("your bookings at");
  });

  it("escapes a name rather than letting it into the markup", () => {
    const mail = buildReminderEmail({
      ...base,
      bookerName: '<script>alert("x")</script>',
      rooms: [meeting1],
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
