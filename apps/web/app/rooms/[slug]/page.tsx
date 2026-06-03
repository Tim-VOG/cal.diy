import { getRoomAvailabilityService } from "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container";
import type { RoomAvailability } from "@calcom/features/ne26-rooms/services/RoomAvailabilityService";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RoomBookingClient from "./RoomBookingClient";

type Params = Promise<{ slug: string }>;

async function loadRoom(slug: string): Promise<RoomAvailability | null> {
  try {
    return await getRoomAvailabilityService().getAvailabilityBySlug(slug);
  } catch (e) {
    if (e instanceof ErrorWithCode && e.code === ErrorCode.NotFound) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadRoom(slug);
  if (!data) return { title: "Room not found · NATO Edge 26" };
  return {
    title: `${data.room.name} · NATO Edge 26`,
    description: data.room.description ?? `Book ${data.room.name} for NATO Edge 26.`,
  };
}

export default async function RoomDetailPage({ params }: { params: Params }): Promise<JSX.Element> {
  const { slug } = await params;
  const data = await loadRoom(slug);
  if (!data) notFound();
  return <RoomBookingClient availability={data} />;
}
