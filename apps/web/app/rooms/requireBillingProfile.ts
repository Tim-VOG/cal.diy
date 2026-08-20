import { getNe26BillingProfileRepository } from "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container";
import { isBillingProfileComplete } from "@calcom/features/ne26-rooms/lib/billing";
import { redirect } from "next/navigation";

/**
 * Send an exhibitor to their billing details until the profile is complete.
 *
 * Those details are printed on the invoice and mirrored onto the Stripe Customer
 * that pre-fills Checkout, so an incomplete profile means a booking that can't be
 * invoiced and a buyer retyping their address at payment time. createBooking
 * already refuses without them — but it refuses at the very last step, after the
 * buyer has chosen a room and a slot. Better to ask up front.
 *
 * `next` carries where they were going, so saving returns them there instead of
 * dropping them on the listing.
 *
 * Admins are exempt: they administer the platform, they don't buy rooms.
 */
export async function requireBillingProfile(
  session: { user?: { id?: number; role?: string } } | null,
  next: string
): Promise<void> {
  const userId = session?.user?.id;
  if (!userId || session?.user?.role === "ADMIN") return;

  const profile = await getNe26BillingProfileRepository().findByUserId(userId);
  if (isBillingProfileComplete(profile)) return;

  redirect(`/rooms/account?next=${encodeURIComponent(next)}`);
}
