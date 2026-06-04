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

export default async function RoomsAccountPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/rooms/account");

  const profile = await getNe26BillingProfileRepository().findByUserId(session.user.id);
  return <BillingProfileForm initial={profile} />;
}
