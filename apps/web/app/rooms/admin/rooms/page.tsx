import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { dayStats } from "@calcom/features/ne26-rooms/lib/dayStats";
import { buildEventSchedule, EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { isRoomIconName } from "@calcom/features/ne26-rooms/lib/roomIcons";
import { normalizeGalleryImages } from "@calcom/features/ne26-rooms/lib/roomImages";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadAdminBookings } from "../adminData";
import { requireNotDeskMode } from "../requireNotDeskMode";
import RoomsManager from "./RoomsManager";

export const metadata: Metadata = {
  title: "Manage rooms · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function ManageRoomsPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/rooms");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const [rooms, roomSettings, bookings] = await Promise.all([
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
    loadAdminBookings(),
  ]);

  // Every room, hidden ones included: the overview shows them too.
  const days = dayStats({
    schedule: buildEventSchedule(roomSettings.eventDays),
    roomNames: rooms.map((r) => r.name),
    bookings: bookings.rows,
    blocks: bookings.blocks,
  });
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: EVENT_TIME_ZONE, weekday: "short" }).format(new Date(iso));
  const occupancy = Object.fromEntries(
    rooms.map((r) => [
      r.name,
      days.map((d) => {
        const room = d.perRoom.find((p) => p.roomName === r.name);
        return {
          label: weekday(d.openUtc),
          soldHours: room?.soldHours ?? 0,
          heldHours: room?.heldHours ?? 0,
          blockedHours: room?.blockedHours ?? 0,
          capacityHours: room?.capacityHours ?? 0,
        };
      }),
    ])
  );
  return (
    <RoomsManager
      bufferMinutes={roomSettings.bufferMinutes}
      eventDays={roomSettings.eventDays}
      occupancy={occupancy}
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
        // Narrowed on the way in, so a name retired from the catalogue since the
        // room was saved falls back to the category default rather than
        // rendering nothing on the page where exhibitors choose.
        iconName: isRoomIconName(r.iconName) ? r.iconName : "",
        isActive: r.isActive,
      }))}
    />
  );
}
