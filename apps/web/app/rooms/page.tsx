import { getRoomAvailabilityService } from "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container";
import { Building, Euro, Users } from "lucide-react";
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
            <h2 className="mt-3 flex items-center gap-2 font-semibold text-lg">
              <Building className="h-5 w-5 shrink-0 text-[#000643]" aria-hidden />
              {room.name}
            </h2>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-gray-500">
                <Users className="h-4 w-4 shrink-0" aria-hidden />
                Up to {room.capacity}
              </span>
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
          </Link>
        ))}
      </div>
    </div>
  );
}
