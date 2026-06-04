import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { computeAvailability, type EventDayAvailability } from "../lib/availability";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

export interface IRoomAvailabilityServiceDeps {
  resourceRepository: ResourceRepository;
  resourceBookingRepository: ResourceBookingRepository;
  ne26RoomSettingsRepository: Ne26RoomSettingsRepository;
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
    const [takenSlotStarts, settings] = await Promise.all([
      this.deps.resourceBookingRepository.findActiveSlotStarts(room.id, new Date()),
      this.deps.ne26RoomSettingsRepository.get(),
    ]);

    return { room: publicRoom, days: computeAvailability(takenSlotStarts, settings.bufferMinutes) };
  }
}
