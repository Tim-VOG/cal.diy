import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceRepository } from "@calcom/features/ne26-rooms/di/ResourceRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireNotDeskMode } from "../requireNotDeskMode";
import BookForExhibitor from "./BookForExhibitor";

export const metadata: Metadata = {
  title: "Book for an exhibitor · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function AdminBookPage(): Promise<JSX.Element> {
  // Page-level authorization (never in a layout): admins only.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/book");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const [rooms, roomSettings] = await Promise.all([
    getResourceRepository().findAllForAdmin(),
    getNe26RoomSettingsRepository().get(),
  ]);

  return (
    <BookForExhibitor
      rooms={rooms
        .filter((r) => r.isActive)
        .map((r) => ({
          slug: r.slug,
          name: r.name,
          price1h: r.price1h,
          price2h: r.price2h,
          price3h: r.price3h,
          currency: r.currency,
        }))}
      granularityMinutes={roomSettings.slotGranularityMinutes}
      eventDays={roomSettings.eventDays}
    />
  );
}
