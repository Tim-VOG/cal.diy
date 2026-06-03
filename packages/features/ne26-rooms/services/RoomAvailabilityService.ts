import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

import { computeAvailability, type EventDayAvailability } from "../lib/availability";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

export interface IRoomAvailabilityServiceDeps {
  resourceRepository: ResourceRepository;
  resourceBookingRepository: ResourceBookingRepository;
}

export type PublicRoom = Awaited<ReturnType<ResourceRepository["findManyActive"]>>[number];

export interface RoomAvailability {
  room: PublicRoom;
  days: EventDayAvailability[];
}

export class RoomAvailabilityService {
  constructor(private deps: IRoomAvailabilityServiceDeps) {}

  getActiveRooms(): Promise<PublicRoom[]> {
    return this.deps.resourceRepository.findManyActive();
  }

  async getAvailabilityBySlug(slug: string): Promise<RoomAvailability> {
    const room = await this.deps.resourceRepository.findBySlug(slug);
    if (!room || !room.isActive) {
      throw new ErrorWithCode(ErrorCode.NotFound, `Room "${slug}" not found`);
    }

    const { isActive: _isActive, ...publicRoom } = room;
    const takenSlotStarts = await this.deps.resourceBookingRepository.findActiveSlotStarts(room.id, new Date());

    return { room: publicRoom, days: computeAvailability(takenSlotStarts) };
  }
}
