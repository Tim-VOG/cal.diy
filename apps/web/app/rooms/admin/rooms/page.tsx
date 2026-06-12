import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { normalizeGalleryImages } from "@calcom/features/ne26-rooms/lib/roomImages";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import RoomsManager from "./RoomsManager";

export const metadata: Metadata = {
  title: "Manage rooms · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageRoomsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/rooms");
  if (session.user.role !== "ADMIN") notFound();

  const [rooms, roomSettings] = await Promise.all([
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
  ]);
  return (
    <RoomsManager
      bufferMinutes={roomSettings.bufferMinutes}
      slotGranularityMinutes={roomSettings.slotGranularityMinutes}
      eventDays={roomSettings.eventDays}
      rooms={rooms.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? "",
        category: r.category,
        capacity: r.capacity,
        surface: r.surface,
        price1h: r.price1h,
        price2h: r.price2h,
        price3h: r.price3h,
        currency: r.currency,
        imageUrl: r.imageUrl ?? "",
        galleryImages: normalizeGalleryImages(r.galleryImages),
        isActive: r.isActive,
      }))}
    />
  );
}
