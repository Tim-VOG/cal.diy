import { redirect } from "next/navigation";

/**
 * The bare address, rooms.vo-eu.be, goes to the rooms.
 *
 * It used to run Cal's own landing logic: anonymous visitors to Cal's login
 * page ("Login | NATO Edge 26", not the NE26 sign-in), signed-in ones through
 * Cal's onboarding to /event-types — a screen that has nothing to do with
 * booking a meeting room. An exhibitor typing the site's name got the one
 * version of the app that was not ours.
 *
 * /rooms already knows what to do with each visitor: the listing for someone
 * signed in, its own sign-in page for someone who is not.
 */
export default function RootPage(): never {
  redirect("/rooms");
}
