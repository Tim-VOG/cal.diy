import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import AccessView from "./AccessView";

export const metadata: Metadata = {
  title: "Access · Rooms admin · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function AccessPage(): Promise<JSX.Element> {
  // Page-level authorization (never in a layout): admins only. Granting roles is
  // the one action that can hand someone else every other action.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/access");
  if (session.user.role !== "ADMIN") notFound();

  return <AccessView />;
}
