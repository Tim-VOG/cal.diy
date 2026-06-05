import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceBookingService } from "@calcom/features/ne26-rooms/di/ResourceBookingService.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import BlocksManager from "./BlocksManager";

export const metadata: Metadata = {
  title: "Blocked slots · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageBlocksPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/blocks");
  if (session.user.role !== "ADMIN") notFound();

  const [blocks, rooms, roomSettings] = await Promise.all([
    getResourceBookingService().listBlocks(),
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
  ]);

  return (
    <BlocksManager
      granularityMinutes={roomSettings.slotGranularityMinutes}
      eventDays={roomSettings.eventDays}
      rooms={rooms.filter((r) => r.isActive).map((r) => ({ slug: r.slug, name: r.name }))}
      blocks={blocks.map((b) => ({
        uid: b.uid,
        roomName: b.resource.name,
        startUtc: b.startTime.toISOString(),
        endUtc: b.endTime.toISOString(),
        durationMinutes: b.durationMinutes,
      }))}
    />
  );
}
