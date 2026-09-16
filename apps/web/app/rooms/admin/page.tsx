import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { dayStats } from "@calcom/features/ne26-rooms/lib/dayStats";
import { buildEventSchedule, EVENT_TIME_ZONE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadAdminBookings } from "./adminData";
import RoomsAdminView from "./RoomsAdminView";
import { requireNotDeskMode } from "./requireNotDeskMode";

export const metadata: Metadata = {
  title: "Rooms admin · NATO Edge 26",
  robots: { index: false, follow: false },
};

/** "Wednesday 16 September · 10:45 TRT · 62 days to the event" */
function todayLabel(now: Date, firstDay: string | undefined): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: EVENT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  if (!firstDay) return `${date} · ${time} TRT`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: EVENT_TIME_ZONE }).format(now);
  const days = Math.round((Date.parse(firstDay) - Date.parse(today)) / 86_400_000);
  const until =
    days > 1
      ? `${days} days to the event`
      : days === 1
        ? "The event starts tomorrow"
        : days === 0
          ? "Event day"
          : "";
  return [date, `${time} TRT`, until].filter(Boolean).join(" · ");
}

export default async function RoomsAdminPage(): Promise<JSX.Element> {
  // Page-level authorization (never in a layout): admins only.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms/admin");
  if (session.user.role !== "ADMIN") notFound();
  await requireNotDeskMode();

  const data = await loadAdminBookings();
  const schedule = buildEventSchedule(data.roomSettings.eventDays);
  const days = dayStats({
    schedule,
    roomNames: data.roomNames,
    bookings: data.rows,
    blocks: data.blocks,
  });

  return (
    <RoomsAdminView
      rows={data.rows}
      rooms={data.rooms}
      blocks={data.blocks}
      days={days}
      attention={data.attention}
      bufferMinutes={data.roomSettings.bufferMinutes}
      todayLabel={todayLabel(new Date(), data.roomSettings.eventDays[0]?.date)}
    />
  );
}
