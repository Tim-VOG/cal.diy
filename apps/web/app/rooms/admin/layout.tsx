import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { deskSessionFromCookieHeader } from "@calcom/features/ne26-rooms/lib/deskSession";
import { attentionCount } from "@calcom/features/ne26-rooms/lib/needsAttention";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import AdminNav from "./AdminNav";
import { loadAdminBookings } from "./adminData";

// Shared admin chrome: the navigation rail beside the page. Authorization stays
// in each page.tsx — layouts don't intercept every request, so they must never
// gate access. They must not leak either: the attention count is read only for
// an admin who is not on the desk tablet, because a page that answers notFound()
// still renders inside this layout.
export default async function RoomsAdminLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const requestHeaders = await headers();
  const session = await getServerSession({ req: buildLegacyRequest(requestHeaders, await cookies()) });
  const isAdmin = session?.user?.role === "ADMIN";
  const onDesk = Boolean(deskSessionFromCookieHeader(requestHeaders.get("cookie")));

  let count = 0;
  if (isAdmin && !onDesk) {
    // Never allowed to break navigation: a failed count just shows none.
    count = await loadAdminBookings()
      .then((data) => attentionCount(data.attention))
      .catch(() => 0);
  }

  return (
    <div className="lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {isAdmin && !onDesk ? <AdminNav attentionCount={count} /> : <div />}
      <div className="mt-6 min-w-0 lg:mt-0">{children}</div>
    </div>
  );
}
