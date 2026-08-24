import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { computeAvailability, type EventDayAvailability } from "../lib/availability";
import { buildEventSchedule } from "../lib/eventSchedule";
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
    // One `now` for both reads: resolving "active hold" and "past start" against
    // the same instant keeps the returned grid internally consistent.
    const now = new Date();
    const [takenSlotStarts, settings] = await Promise.all([
      this.deps.resourceBookingRepository.findActiveSlotStarts(room.id, now),
      this.deps.ne26RoomSettingsRepository.get(),
    ]);

    return {
      room: publicRoom,
      days: computeAvailability(
        takenSlotStarts,
        settings.bufferMinutes,
        now,
        buildEventSchedule(settings.eventDays)
      ),
    };
  }
}
