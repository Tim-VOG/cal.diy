import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { canWorkTheDesk } from "@calcom/features/ne26-rooms/lib/staff";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import DeskNav from "./DeskNav";

export const metadata: Metadata = {
  title: "Welcome desk · NATO Edge 26",
  robots: { index: false, follow: false },
};

/**
 * The welcome desk: a separate module from the admin dashboard, not a tab in it.
 *
 * A hostess needs today's schedule, a search box and a way to start a booking —
 * and must never be one mistaken click away from pricing, refunds or settings.
 * Keeping it behind its own route means the admin surface simply is not reachable
 * from here.
 *
 * The authorization check is repeated on every procedure this page calls; this
 * layout check only keeps the wrong person from seeing the shell.
 */
export default async function DeskLayout({ children }: { children: React.ReactNode }): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/desk");

  const { getNe26StaffRepository } = await import(
    "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
  );
  const staffRole =
    session.user.role === "ADMIN" ? null : await getNe26StaffRepository().findStaffRole(session.user.id);

  if (
    !canWorkTheDesk({
      userId: session.user.id,
      email: session.user.email ?? "",
      calRole: session.user.role,
      staffRole,
    })
  ) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <DeskNav isAdmin={session.user.role === "ADMIN"} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
