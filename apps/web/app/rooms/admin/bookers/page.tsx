import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { bookingDocuments } from "@calcom/features/ne26-rooms/lib/bookingDocuments";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireNotDeskMode } from "../requireNotDeskMode";
import BookerAccounts from "./BookerAccounts";
import BookersView, { type Booker } from "./BookersView";

export const metadata: Metadata = {
  title: "Bookers · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function BookersPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/bookers");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const [bookings, roomSettings] = await Promise.all([
    getResourceBookingRepository().findAllWithDetails(),
    getNe26RoomSettingsRepository().get(),
  ]);

  // Group bookings by booker (email is the stable identity across bookings).
  const byEmail = new Map<string, Booker>();
  for (const b of bookings) {
    const booker = byEmail.get(b.bookerEmail) ?? {
      email: b.bookerEmail,
      name: b.bookerName,
      currency: b.currency,
      bookingCount: 0,
      confirmedTotal: 0,
      bookings: [],
    };
    booker.bookingCount += 1;
    if (b.status === "CONFIRMED") booker.confirmedTotal += b.amountTotal;
    booker.bookings.push({
      uid: b.uid,
      roomName: b.resource.name,
      startUtc: b.startTime.toISOString(),
      endUtc: b.endTime.toISOString(),
      status: b.status,
      amountTotal: b.amountTotal,
      currency: b.currency,
      // The order's documents, not the room's: read from the room alone, every
      // sale made through an order showed no invoice here.
      ...bookingDocuments(b),
      addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity })),
    });
    byEmail.set(b.bookerEmail, booker);
  }

  const bookers = Array.from(byEmail.values()).sort((a, b) => b.confirmedTotal - a.confirmedTotal);

  return (
    <>
      <BookersView bookers={bookers} eventDates={roomSettings.eventDays.map((d) => d.date)} />
      {/* Below the bookers: the list above is built from bookings, so it cannot
          show someone who registered and has not bought yet — this can. */}
      <BookerAccounts />
    </>
  );
}
