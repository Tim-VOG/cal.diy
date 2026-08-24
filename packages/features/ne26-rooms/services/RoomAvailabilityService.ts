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

  /**
   * Availability for every room on sale, in three queries rather than 3n.
   *
   * The desk's booking screen needs the whole grid. Asking room by room meant
   * nine round-trips AND nine reads of the same settings row each time a
   * hostess opened it — on the page she opens most.
   */
  async getAvailabilityForAllRooms(): Promise<RoomAvailability[]> {
    const rooms = await this.deps.resourceRepository.findManyActive();
    // One `now` for every room, so the grid cannot disagree with itself.
    const now = new Date();
    const [slotsByRoom, settings] = await Promise.all([
      this.deps.resourceBookingRepository.findActiveSlotStartsForRooms(
        rooms.map((r) => r.id),
        now
      ),
      this.deps.ne26RoomSettingsRepository.get(),
    ]);
    const schedule = buildEventSchedule(settings.eventDays);

    return rooms.map((room) => ({
      room,
      days: computeAvailability(slotsByRoom.get(room.id) ?? [], settings.bufferMinutes, now, schedule),
    }));
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
