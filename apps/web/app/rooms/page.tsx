import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import { getNe26RoomSettingsRepository } from "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container";
import { getRoomAvailabilityService } from "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { Euro, Scaling, Users } from "lucide-react";
import { roomIconFor } from "./roomIcon";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { servicesFor } from "./amenities";
import { requireBillingProfile } from "./requireBillingProfile";

export const metadata: Metadata = {
  title: "Meeting Rooms · NATO Edge 26",
  description: "Book a meeting room for NATO Edge 26 (17–19 November 2026).",
};

/**
 * Shown when an admin has not set their own intro. Jolanda's wording, adapted
 * once the one-room-per-day rule was settled: it has to state the rule, because
 * an exhibitor who only meets it as a refusal at checkout has already chosen a
 * room. TRT is Turkey Time — the event runs in Izmir.
 */
const DEFAULT_LANDING_INTRO = `Reserve a private meeting room during NATO Edge 26 (17–19 November 2026, Izmir) for professional, confidential meetings. Ideal for strategic discussions, partnership negotiations, and client meetings.

You can book a maximum of one room per day, for one time slot of either 1, 2, or 3 hours. Choose your room, select your preferred 1-, 2-, or 3-hour slot, add any extras, then confirm and pay securely online. All times are shown in TRT.`;

const CATEGORY_LABEL: Record<string, string> = {
  PREMIUM: "Premium",
  INTERMEDIATE: "Intermediate",
  ENTRY: "Entry",
};
// Display order of the category blocks; any other category is appended after.
const CATEGORY_ORDER = ["PREMIUM", "INTERMEDIATE", "ENTRY"];

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100
  );
}

type Room = Awaited<ReturnType<ReturnType<typeof getRoomAvailabilityService>["getActiveRooms"]>>[number];

function RoomCard({ room }: { room: Room }): JSX.Element {
  const TitleIcon = roomIconFor(room.category);
  return (
    <Link
      href={`/rooms/${room.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-[#000643] hover:shadow-md">
      <div className="relative h-40 w-full bg-[#000643]/5">
        {room.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: admin-provided URL/path, next/image adds no value here
          <img src={room.imageUrl} alt={room.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[#000643]/45">
            <TitleIcon className="h-12 w-12" strokeWidth={1.75} aria-hidden />
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white/90 px-2.5 py-0.5 font-medium text-[#000643] text-xs shadow-sm">
          {CATEGORY_LABEL[room.category] ?? room.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="flex items-center gap-2 font-semibold text-lg">
          <TitleIcon className="h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
          {room.name}
        </h3>
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 text-gray-500">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4 shrink-0" aria-hidden />
              {room.capacity}
            </span>
            <span className="flex items-center gap-1.5">
              <Scaling className="h-4 w-4 shrink-0" aria-hidden />
              {room.surface} m²
            </span>
          </div>
          <span className="flex items-center gap-1 font-medium text-[#000643]">
            <Euro className="h-4 w-4 shrink-0" aria-hidden />
            from {formatPrice(room.price1h, room.currency)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 border-gray-100 border-t pt-3 text-gray-400">
          {servicesFor(room.category).map(({ icon: AmenityIcon, label }) => (
            <span key={label} title={label} aria-label={label}>
              <AmenityIcon className="h-4 w-4 shrink-0" aria-hidden />
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export default async function RoomsListingPage(): Promise<JSX.Element> {
  // Rooms are exhibitor-only: require an account to browse the listing.
  const session = await getServerSession({ req: buildLegacyRequest(await headers(), await cookies()) });
  if (!session?.user?.id) redirect("/rooms/login?callbackUrl=/rooms");
  await requireBillingProfile(session, "/rooms");

  const [rooms, settings] = await Promise.all([
    getRoomAvailabilityService().getActiveRooms(),
    getNe26RoomSettingsRepository().get(),
  ]);

  const byCategory = new Map<string, Room[]>();
  for (const room of rooms) {
    const list = byCategory.get(room.category) ?? [];
    list.push(room);
    byCategory.set(room.category, list);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...Array.from(byCategory.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div>
      {settings.landingTitle ? (
        <p className="font-semibold text-[#000643] text-sm uppercase tracking-wide">
          {settings.landingTitle}
        </p>
      ) : null}
      <h1 className="mt-1 font-bold text-2xl text-[#000643]">Book a meeting room</h1>
      <p className="mt-2 whitespace-pre-line text-gray-600 text-sm">
        {settings.landingIntro?.trim() ? settings.landingIntro : DEFAULT_LANDING_INTRO}
      </p>

      {orderedCategories.map((category) => (
        <section key={category} className="mt-8">
          <h2 className="font-semibold text-[#000643] text-sm uppercase tracking-wide">
            {CATEGORY_LABEL[category] ?? category}
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(byCategory.get(category) ?? []).map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
