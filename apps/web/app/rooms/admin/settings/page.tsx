import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getInvoiceSettingsRepository } from "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import InvoiceSettingsForm from "./InvoiceSettingsForm";
import LandingContentForm from "./LandingContentForm";
import { requireNotDeskMode } from "../requireNotDeskMode";

export const metadata: Metadata = {
  title: "Settings · NATO Edge 26",
  robots: { index: false, follow: false },
};

export default async function SettingsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/settings");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const [invoiceSettings, roomSettings] = await Promise.all([
    getInvoiceSettingsRepository().get(),
    getNe26RoomSettingsRepository().get(),
  ]);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <InvoiceSettingsForm initial={invoiceSettings} />
      <LandingContentForm
        initialTitle={roomSettings.landingTitle ?? ""}
        initialIntro={roomSettings.landingIntro ?? ""}
      />
    </div>
  );
}
