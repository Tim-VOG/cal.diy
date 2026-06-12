import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import BookersView, { type Booker } from "./BookersView";

export const metadata: Metadata = {
  title: "Bookers · NATO Edge 26 admin",
  robots: { index: false, follow: false },
};

export default async function BookersPage(): Promise<JSX.Element> {
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin/bookers");
  if (session.user.role !== "ADMIN") notFound();

  const bookings = await getResourceBookingRepository().findAllWithDetails();

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
      invoiceNumber: b.invoiceNumber,
      creditNoteNumber: b.creditNoteNumber,
      addOns: b.addOns.map((a) => ({ name: a.addOn.name, quantity: a.quantity })),
    });
    byEmail.set(b.bookerEmail, booker);
  }

  const bookers = Array.from(byEmail.values()).sort((a, b) => b.confirmedTotal - a.confirmedTotal);

  return <BookersView bookers={bookers} />;
}
