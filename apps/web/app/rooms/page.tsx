import { getRoomAvailabilityService } from "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Meeting Rooms · NATO Edge 26",
  description: "Book a meeting room for NATO Edge 26 (17–19 November 2026).",
};

const CATEGORY_LABEL: Record<string, string> = {
  PREMIUM: "Premium",
  INTERMEDIATE: "Intermediate",
  ENTRY: "Entry",
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    cents / 100
  );
}

export default async function RoomsListingPage(): Promise<JSX.Element> {
  const rooms = await getRoomAvailabilityService().getActiveRooms();

  return (
    <div>
      <h1 className="font-bold text-2xl text-[#000643]">Book a meeting room</h1>
      <p className="mt-1 text-gray-600 text-sm">
        Choose a room, a time slot (1h, 2h or 3h) and add-ons. Times shown in Europe/Brussels.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => (
          <Link
            key={room.id}
            href={`/rooms/${room.slug}`}
            className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[#000643] hover:shadow-md">
            <span className="self-start rounded-full bg-[#000643]/10 px-2.5 py-0.5 font-medium text-[#000643] text-xs">
              {CATEGORY_LABEL[room.category] ?? room.category}
            </span>
            <h2 className="mt-3 font-semibold text-lg">{room.name}</h2>
            {room.description ? <p className="mt-1 text-gray-600 text-sm">{room.description}</p> : null}
            <div className="mt-4 flex items-end justify-between">
              <span className="text-gray-500 text-sm">Up to {room.capacity} people</span>
              <span className="font-medium text-[#000643] text-sm">
                from {formatPrice(room.price1h, room.currency)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
