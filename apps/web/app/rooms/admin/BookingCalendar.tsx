"use client";

import { EVENT_SCHEDULE } from "@calcom/features/ne26-rooms/lib/eventSchedule";
import type { AdminBookingRow } from "./RoomsAdminView";

const TZ = "Europe/Brussels";

function hourLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

const BLOCK_CLASS: Record<string, string> = {
  CONFIRMED: "bg-green-100 text-green-800 hover:bg-green-200",
  PENDING: "bg-amber-100 text-amber-800 hover:bg-amber-200",
  CANCELLED: "bg-gray-100 text-gray-400 line-through hover:bg-gray-200",
};

export default function BookingCalendar({
  rows,
  roomNames,
  selectedUid,
  onSelect,
}: {
  rows: AdminBookingRow[];
  roomNames: string[];
  selectedUid: string | null;
  onSelect: (uid: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-8">
      {EVENT_SCHEDULE.map((day) => {
        const hours = day.sellableHourStartsUtc.map((d) => d.toISOString());
        // A booking starts on one of the day's sellable hours; index by room + start.
        const byRoomStart = new Map<string, AdminBookingRow>();
        for (const row of rows) {
          if (hours.includes(row.startUtc)) byRoomStart.set(`${row.roomName}|${row.startUtc}`, row);
        }

        return (
          <div key={day.date}>
            <h3 className="font-semibold text-[#000643] text-sm">{dayLabel(day.date)}</h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="border-gray-100 border-b border-r px-3 py-2 text-left font-medium">
                      Room
                    </th>
                    {hours.map((h) => (
                      <th key={h} className="border-gray-100 border-b px-2 py-2 text-center font-medium">
                        {hourLabel(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roomNames.map((room) => {
                    const cells: JSX.Element[] = [];
                    let i = 0;
                    while (i < hours.length) {
                      const booking = byRoomStart.get(`${room}|${hours[i]}`);
                      if (booking) {
                        const span = Math.max(1, Math.min(booking.durationMinutes / 60, hours.length - i));
                        const selected = booking.uid === selectedUid;
                        cells.push(
                          <td key={hours[i]} colSpan={span} className="border-gray-100 border-b p-1">
                            <button
                              type="button"
                              onClick={() => onSelect(booking.uid)}
                              className={`w-full truncate rounded-md px-2 py-1.5 text-left font-medium text-xs transition ${
                                BLOCK_CLASS[booking.status] ?? "bg-gray-100"
                              } ${selected ? "ring-2 ring-[#000643]" : ""}`}
                              title={`${booking.bookerName} · ${booking.status}`}>
                              {booking.bookerName}
                            </button>
                          </td>
                        );
                        i += span;
                      } else {
                        cells.push(<td key={hours[i]} className="border-gray-100 border-b px-2 py-2" />);
                        i += 1;
                      }
                    }
                    return (
                      <tr key={room}>
                        <td className="border-gray-100 border-b border-r px-3 py-2 font-medium text-gray-700">
                          {room}
                        </td>
                        {cells}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
