import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getInvoiceSettingsRepository } from "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cancellationDeadline } from "@calcom/features/ne26-rooms/lib/cancellationPolicy";
import { buildEventSchedule } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { requireNotDeskMode } from "../requireNotDeskMode";
import CancellationWindowForm from "./CancellationWindowForm";
import InvoiceSettingsForm from "./InvoiceSettingsForm";
import LandingContentForm from "./LandingContentForm";

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

  // Computed here, from the event's own days, so the screen states the real
  // instant rather than asking an admin to count backwards from it.
  const deadline = cancellationDeadline(
    buildEventSchedule(roomSettings.eventDays),
    roomSettings.cancellationDeadlineDays
  );

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <InvoiceSettingsForm initial={invoiceSettings} />
      <CancellationWindowForm
        days={roomSettings.cancellationDeadlineDays}
        deadlineUtc={deadline ? deadline.toISOString() : null}
      />
      <LandingContentForm
        initialTitle={roomSettings.landingTitle ?? ""}
        initialIntro={roomSettings.landingIntro ?? ""}
      />
    </div>
  );
}
