import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { type EventDayDefinition, normalizeEventDays } from "../lib/eventSchedule";

const settingsSelect = {
  bufferMinutes: true,
  slotGranularityMinutes: true,
  eventDays: true,
} as const;

export interface RoomSettings {
  /** Turnover buffer in minutes required after each booking. */
  bufferMinutes: number;
  /** Start step offered to bookers (60/30/15). Atomic slot stays 15 min. */
  slotGranularityMinutes: number;
  /** Opening hours per event day (Brussels). Falls back to built-in defaults. */
  eventDays: EventDayDefinition[];
}

interface SettingsRow {
  bufferMinutes: number;
  slotGranularityMinutes: number;
  eventDays: Prisma.JsonValue | null;
}

function toSettings(row: SettingsRow): RoomSettings {
  return {
    bufferMinutes: row.bufferMinutes,
    slotGranularityMinutes: row.slotGranularityMinutes,
    eventDays: normalizeEventDays(row.eventDays),
  };
}

export class Ne26RoomSettingsRepository {
  constructor(private prismaClient: PrismaClient) {}

  // Singleton row (id=1); upsert guarantees it exists without a seed step.
  async get(): Promise<RoomSettings> {
    const row = await this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: settingsSelect,
    });
    return toSettings(row);
  }

  async update(data: Partial<RoomSettings>): Promise<RoomSettings> {
    const patch: {
      bufferMinutes?: number;
      slotGranularityMinutes?: number;
      eventDays?: Prisma.InputJsonValue;
    } = {};
    if (data.bufferMinutes !== undefined) patch.bufferMinutes = data.bufferMinutes;
    if (data.slotGranularityMinutes !== undefined) patch.slotGranularityMinutes = data.slotGranularityMinutes;
    if (data.eventDays !== undefined) patch.eventDays = data.eventDays;

    const row = await this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...patch },
      update: patch,
      select: settingsSelect,
    });
    return toSettings(row);
  }
}
