import type { PrismaClient } from "@calcom/prisma";

const settingsSelect = {
  bufferMinutes: true,
  slotGranularityMinutes: true,
} as const;

export interface RoomSettings {
  /** Turnover buffer in minutes required after each booking. */
  bufferMinutes: number;
  /** Start step offered to bookers (60/30/15). Atomic slot stays 15 min. */
  slotGranularityMinutes: number;
}

export class Ne26RoomSettingsRepository {
  constructor(private prismaClient: PrismaClient) {}

  // Singleton row (id=1); upsert guarantees it exists without a seed step.
  get(): Promise<RoomSettings> {
    return this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
      select: settingsSelect,
    });
  }

  async update(data: Partial<RoomSettings>): Promise<RoomSettings> {
    return this.prismaClient.ne26RoomSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
      select: settingsSelect,
    });
  }
}
