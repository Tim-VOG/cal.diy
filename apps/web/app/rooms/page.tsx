import { getRoomAvailabilityService } from "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container";
import { Building, Euro, Scaling, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AMENITIES } from "./amenities";

export const metadata: Metadata = {
  title: "Meeting Rooms · NATO Edge 26",
  description: "Book a meeting room for NATO Edge 26 (17–19 November 2026).",
};

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
  return (
    <Link
      href={`/rooms/${room.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-[#000643] hover:shadow-md">
      <div className="relative h-40 w-full bg-[#000643]/5">
        {room.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: admin-provided URL/path, next/image adds no value here
          <img src={room.imageUrl} alt={room.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[#000643]/25">
            <Building className="h-10 w-10" aria-hidden />
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-white/90 px-2.5 py-0.5 font-medium text-[#000643] text-xs shadow-sm">
          {CATEGORY_LABEL[room.category] ?? room.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="flex items-center gap-2 font-semibold text-lg">
          <Building className="h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
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
          {AMENITIES.map(({ icon: AmenityIcon, label }) => (
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
  const rooms = await getRoomAvailabilityService().getActiveRooms();

  const byCategory = new Map<string, Room[]>();
  for (const room of rooms) {
    const list = byCategory.get(room.category) ?? [];
    list.push(room);
    byCategory.set(room.category, list);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Book a meeting room</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Choose a room, a time slot (1h, 2h or 3h) and add-ons. Times shown in Europe/Brussels.
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
