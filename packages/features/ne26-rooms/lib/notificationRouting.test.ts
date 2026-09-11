import { describe, expect, it } from "vitest";
import { parseAddressList, routeNotification } from "./notificationRouting";

const SETTINGS = {
  notifyEmails: "sales@vo-europe.eu",
  technicalEmails: "ne26@vo-group.be",
  contactEmail: "info@vo-europe.eu",
};

describe("routeNotification", () => {
  it("sends a sale to the desk, with the technical address in copy", () => {
    expect(routeNotification("sales", SETTINGS)).toEqual({
      to: ["sales@vo-europe.eu"],
      cc: ["ne26@vo-group.be"],
    });
  });

  it("keeps an unreconciled payment away from the sales desk", () => {
    // The whole point of the split: nobody on sales can act on a capture with
    // no matching order, and burying "Room sold" under alerts like it is how
    // the ones that matter stop being read.
    expect(routeNotification("ops", SETTINGS)).toEqual({
      to: ["ne26@vo-group.be"],
      cc: [],
    });
  });

  it("never lists the same address as both recipient and copy", () => {
    const both = { ...SETTINGS, notifyEmails: "sales@vo-europe.eu, NE26@vo-group.be" };
    const envelope = routeNotification("sales", both);
    expect(envelope.to).toEqual(["sales@vo-europe.eu", "NE26@vo-group.be"]);
    expect(envelope.cc).toEqual([]);
  });

  it("still delivers an alert when no technical address is configured", () => {
    // Bothering the sales desk with a reconciliation is a nuisance. Losing it
    // is a payment nobody ever looks at.
    expect(routeNotification("ops", { ...SETTINGS, technicalEmails: "" })).toEqual({
      to: ["sales@vo-europe.eu"],
      cc: [],
    });
  });

  it("promotes the technical address rather than dropping a sale with no desk", () => {
    const envelope = routeNotification("sales", { ...SETTINGS, notifyEmails: "" });
    expect(envelope.to).toEqual(["ne26@vo-group.be"]);
    // Promoted into "to", so it must not also appear in copy.
    expect(envelope.cc).toEqual([]);
  });

  it("falls back to the contact address, then to whatever the caller offers", () => {
    const bare = { notifyEmails: "", technicalEmails: "", contactEmail: "info@vo-europe.eu" };
    expect(routeNotification("sales", bare).to).toEqual(["info@vo-europe.eu"]);
    expect(routeNotification("ops", bare).to).toEqual(["info@vo-europe.eu"]);

    const empty = { notifyEmails: "", technicalEmails: "", contactEmail: "" };
    expect(routeNotification("ops", empty, "noreply@vo-europe.eu").to).toEqual(["noreply@vo-europe.eu"]);
  });

  it("gives up only when there is genuinely nowhere to send", () => {
    expect(routeNotification("sales", { notifyEmails: "", technicalEmails: "", contactEmail: "" })).toEqual({
      to: [],
      cc: [],
    });
  });

  it("treats a whitespace-only setting as unset", () => {
    const envelope = routeNotification("ops", { ...SETTINGS, technicalEmails: "   ,  ; " });
    expect(envelope.to).toEqual(["sales@vo-europe.eu"]);
  });
});

describe("parseAddressList", () => {
  it("accepts the separator Outlook hands out as well as ours", () => {
    expect(parseAddressList("a@x.be; b@x.be, c@x.be")).toEqual(["a@x.be", "b@x.be", "c@x.be"]);
  });

  it("drops repeats without changing how an address is spelled", () => {
    // Kept as typed: an address is displayed back to the admin in the settings
    // screen, and silently lowercasing it looks like the field ate the input.
    expect(parseAddressList("Sales@VO.be, sales@vo.be")).toEqual(["Sales@VO.be"]);
  });

  it("is empty for nothing at all", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList(" , ; ")).toEqual([]);
  });
});
