import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { ResourceBookingStatus } from "@calcom/prisma/enums";
import { getAtomicSlotStarts, getBufferSlotStarts } from "../lib/atomicSlots";
import { buildEventSchedule, buildOpenSlotMs, type DurationHours } from "../lib/eventSchedule";
import { type ResolvedAddOnLine, resolveAddOnLines } from "../lib/pricing";
import type { AddOnRepository } from "../repositories/AddOnRepository";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import type { ResourceBookingRepository } from "../repositories/ResourceBookingRepository";
import type { ResourceRepository } from "../repositories/ResourceRepository";

const MS_PER_MINUTE = 60 * 1000;

export interface IResourceBookingServiceDeps {
  resourceRepository: ResourceRepository;
  addOnRepository: AddOnRepository;
  resourceBookingRepository: ResourceBookingRepository;
  ne26RoomSettingsRepository: Ne26RoomSettingsRepository;
}

export class ResourceBookingService {
  constructor(private deps: IResourceBookingServiceDeps) {}

  /** Admin: confirm a PENDING booking paid outside Stripe. Idempotent. */
  async confirmManually(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.confirmManuallyByUid(uid);
    return count > 0;
  }

  /** Admin: cancel a PENDING booking (no credit note) and free its slots. */
  async cancelPending(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.cancelPendingByUid(uid);
    return count > 0;
  }

  /**
   * Admin: block a room on a slot (maintenance / internal use). Occupies the
   * atomic hours like a confirmed booking — the DB rejects a block that overlaps
   * an existing booking (surfaced as a BookingConflict).
   */
  async createBlock(input: { slug: string; startUtc: Date; durationHours: DurationHours }): Promise<void> {
    const room = await this.deps.resourceRepository.findBySlug(input.slug);
    if (!room) throw new ErrorWithCode(ErrorCode.NotFound, `Room "${input.slug}" not found`);

    const settings = await this.deps.ne26RoomSettingsRepository.get();
    const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));

    const durationMinutes = input.durationHours * 60;
    const slotStarts = getAtomicSlotStarts(input.startUtc, durationMinutes);
    for (const slot of slotStarts) {
      if (!openSlotMs.has(slot.getTime())) {
        throw new ErrorWithCode(ErrorCode.BadRequest, "Selected time is outside the event opening hours.");
      }
    }
    const endTime = new Date(input.startUtc.getTime() + durationMinutes * MS_PER_MINUTE);

    await this.deps.resourceBookingRepository.createWithSlots({
      resourceId: room.id,
      startTime: input.startUtc,
      endTime,
      durationMinutes,
      slotStarts,
      bookerEmail: "block@ne26.internal",
      bookerName: "BLOCKED (admin)",
      amountTotal: 0,
      currency: room.currency,
      status: ResourceBookingStatus.CONFIRMED,
      isBlock: true,
    });
  }

  listBlocks() {
    return this.deps.resourceBookingRepository.findBlocks();
  }

  async removeBlock(uid: string): Promise<boolean> {
    const count = await this.deps.resourceBookingRepository.removeBlockByUid(uid);
    return count > 0;
  }

  private async resolveAddOnLines(
    requested: { slug: string; quantity: number }[],
    durationHours: number,
    roomCapacity: number
  ): Promise<ResolvedAddOnLine[]> {
    if (!requested.length) return [];
    const catalog = await this.deps.addOnRepository.findManyActiveBySlugs(requested.map((a) => a.slug));
    return resolveAddOnLines(requested, catalog, { durationHours, roomCapacity });
  }
}
