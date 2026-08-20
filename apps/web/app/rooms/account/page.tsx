import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26BillingProfileRepository } from "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import BillingProfileForm from "./BillingProfileForm";

export const metadata: Metadata = {
  title: "Billing details · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function RoomsAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/account");

  const profile = await getNe26BillingProfileRepository().findByUserId(session.user.id);
  // Only ever an in-app path, never an absolute URL: this value comes from the
  // query string and is used as a redirect target after saving.
  const raw = (await searchParams).next ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : null;

  return <BillingProfileForm initial={profile} next={next} />;
}
