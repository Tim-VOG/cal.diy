import { describe, expect, it } from "vitest";
import { confineRoute } from "./routeConfinement";

const exhibitor = (pathname: string) => confineRoute({ pathname, role: "USER" });
const HOME = { action: "redirect", to: "/rooms" };
const ALLOW = { action: "allow" };

describe("a signed-in exhibitor", () => {
  it("is sent back to the rooms from Cal's own screens", () => {
    for (const path of [
      "/event-types",
      "/event-types/12",
      "/apps",
      "/apps/installed/calendar",
      "/availability",
      "/settings/my-account/profile",
      "/getting-started",
      "/bookings/upcoming",
      "/teams",
      "/workflows",
    ]) {
      expect(exhibitor(path), path).toEqual(HOME);
    }
  });

  it("keeps the whole NE26 app, the hostess desk included", () => {
    for (const path of [
      "/rooms",
      "/rooms/small-room-1",
      "/rooms/bookings",
      "/rooms/account",
      "/rooms/booked",
      "/rooms/invoice/12389044-0faa-45ba-9a07-66d30989b0a8",
      "/rooms/legal/terms",
      "/rooms/desk",
      "/rooms/desk/planning",
    ]) {
      expect(exhibitor(path), path).toEqual(ALLOW);
    }
  });

  it("can still sign out and recover a password", () => {
    // Sending sign-out back to /rooms would leave an exhibitor unable to leave.
    for (const path of [
      "/auth/logout",
      "/auth/forgot-password",
      "/auth/forgot-password/abc123",
      "/auth/verify-email",
    ]) {
      expect(exhibitor(path), path).toEqual(ALLOW);
    }
  });

  it("does not have the calls its own pages make redirected", () => {
    for (const path of [
      "/api/trpc/rooms/list",
      "/api/auth/signout",
      "/api/webhooks/ne26-rooms/stripe",
      "/_next/data/x.json",
    ]) {
      expect(exhibitor(path), path).toEqual(ALLOW);
    }
  });

  it("matches whole segments, not look-alike prefixes", () => {
    expect(exhibitor("/roomsxyz")).toEqual(HOME);
    expect(exhibitor("/authority")).toEqual(HOME);
    expect(exhibitor("/apix")).toEqual(HOME);
  });

  it("is not talked past by an encoded path", () => {
    // Decoded, this starts with "/rooms/". Raw, it does not, and it goes home.
    expect(exhibitor("/%72ooms")).toEqual(HOME);
    expect(exhibitor("/%61pps")).toEqual(HOME);
  });

  it("lets the root through, which redirects to the rooms by itself", () => {
    expect(exhibitor("/")).toEqual(ALLOW);
  });

  it("applies to a hostess as well, who has no use for Cal's screens either", () => {
    // Hostesses are USER accounts with an NE26 staff role; the desk is under /rooms.
    expect(exhibitor("/event-types")).toEqual(HOME);
  });
});

describe("who is not confined", () => {
  it("an administrator, active or not", () => {
    expect(confineRoute({ pathname: "/settings/admin", role: "ADMIN" })).toEqual(ALLOW);
    // An admin without 2FA gets this role from Cal; still Tim, still an admin.
    expect(confineRoute({ pathname: "/settings/admin", role: "INACTIVE_ADMIN" })).toEqual(ALLOW);
  });

  it("an anonymous visitor, so the public 404 and Cal's sign-in still answer", () => {
    expect(confineRoute({ pathname: "/event-types", role: null })).toEqual(ALLOW);
    expect(confineRoute({ pathname: "/some-mistyped-address", role: undefined })).toEqual(ALLOW);
  });
});
