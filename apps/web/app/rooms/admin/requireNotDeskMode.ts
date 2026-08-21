import { deskSessionFromCookieHeader } from "@calcom/features/ne26-rooms/lib/deskSession";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Keep a tablet in desk mode out of the admin, by URL as well as by button.
 *
 * The tRPC layer already refuses every administrative mutation while the desk
 * cookie is set, but admin pages are server components that read the database
 * directly — so without this, typing /rooms/admin on the counter tablet would
 * still render the bookings, the revenue and the settings, even if nothing could
 * be changed. Called per page, like the admin check itself, rather than in a
 * layout.
 */
export async function requireNotDeskMode(): Promise<void> {
  const desk = deskSessionFromCookieHeader((await headers()).get("cookie"));
  if (desk) redirect("/rooms/desk");
}
