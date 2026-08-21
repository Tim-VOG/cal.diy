import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { type EventDayDefinition, normalizeEventDays } from "../lib/eventSchedule";

const settingsSelect = {
  bufferMinutes: true,
  slotGranularityMinutes: true,
  eventDays: true,
  landingTitle: true,
  landingIntro: true,
} as const;

export interface RoomSettings {
  /** Turnover buffer in minutes required after each booking. */
  bufferMinutes: number;
  /** Start step offered to bookers (60/30/15). Atomic slot stays 15 min. */
  slotGranularityMinutes: number;
  /** Opening hours per event day (Brussels). Falls back to built-in defaults. */
  eventDays: EventDayDefinition[];
  /** Public landing title, shown above "Book a meeting room". */
  landingTitle: string | null;
  /** Public landing intro paragraph. */
  landingIntro: string | null;
}

interface SettingsRow {
  bufferMinutes: number;
  slotGranularityMinutes: number;
  eventDays: Prisma.JsonValue | null;
  landingTitle: string | null;
  landingIntro: string | null;
}

function toSettings(row: SettingsRow): RoomSettings {
  return {
    bufferMinutes: row.bufferMinutes,
    slotGranularityMinutes: row.slotGranularityMinutes,
    eventDays: normalizeEventDays(row.eventDays),
    landingTitle: row.landingTitle,
    landingIntro: row.landingIntro,
  };
}

export class Ne26RoomSettingsRepository {
  constructor(private prismaClient: PrismaClient) {}

  /**
   * Settings for the singleton row (id=1).
   *
   * Read-first, and that matters: this is on the hot path — every listing, every
   * room page and every availability computation calls it. Written as an upsert
   * it took a row-level write lock on the same single row for every one of
   * those, so concurrent buyers across nine rooms all queued behind each other
   * on a row nobody was changing.
   *
   * The upsert is kept only for the one request that finds no row, so a fresh
   * install still needs no seed step. Two racing first requests are fine: the
   * create collides on the primary key, and the fallback read returns the row
   * the winner just made.
   */
  async get(): Promise<RoomSettings> {
    const existing = await this.prismaClient.ne26RoomSettings.findUnique({
      where: { id: 1 },
      select: settingsSelect,
    });
    if (existing) return toSettings(existing);

    const row = await this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: settingsSelect,
    });
    return toSettings(row);
  }

  /**
   * The desk PIN and its attempt state. Kept off `get()` on purpose: that runs on
   * every public page, and a password hash has no business travelling with it.
   */
  async getDeskPinState(): Promise<{
    hash: string | null;
    failedAttempts: number;
    lockedUntil: Date | null;
  }> {
    const row = await this.prismaClient.ne26RoomSettings.findUnique({
      where: { id: 1 },
      select: { deskPinHash: true, deskPinFailedAttempts: true, deskPinLockedUntil: true },
    });
    return {
      hash: row?.deskPinHash ?? null,
      failedAttempts: row?.deskPinFailedAttempts ?? 0,
      lockedUntil: row?.deskPinLockedUntil ?? null,
    };
  }

  async setDeskPinHash(hash: string | null): Promise<void> {
    await this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1, deskPinHash: hash },
      update: { deskPinHash: hash, deskPinFailedAttempts: 0, deskPinLockedUntil: null },
    });
  }

  async setDeskPinLockState(failedAttempts: number, lockedUntil: Date | null): Promise<void> {
    await this.prismaClient.ne26RoomSettings.update({
      where: { id: 1 },
      data: { deskPinFailedAttempts: failedAttempts, deskPinLockedUntil: lockedUntil },
    });
  }

  async update(data: Partial<RoomSettings>): Promise<RoomSettings> {
    const patch: {
      bufferMinutes?: number;
      slotGranularityMinutes?: number;
      eventDays?: Prisma.InputJsonValue;
      landingTitle?: string | null;
      landingIntro?: string | null;
    } = {};
    if (data.bufferMinutes !== undefined) patch.bufferMinutes = data.bufferMinutes;
    if (data.slotGranularityMinutes !== undefined) patch.slotGranularityMinutes = data.slotGranularityMinutes;
    if (data.eventDays !== undefined) patch.eventDays = data.eventDays;
    if (data.landingTitle !== undefined) patch.landingTitle = data.landingTitle;
    if (data.landingIntro !== undefined) patch.landingIntro = data.landingIntro;

    const row = await this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...patch },
      update: patch,
      select: settingsSelect,
    });
    return toSettings(row);
  }
}
