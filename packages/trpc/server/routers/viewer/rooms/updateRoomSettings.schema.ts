import { z } from "zod";

export const ZUpdateRoomSettingsInputSchema = z.object({
  /** Turnover buffer in minutes after each booking (0 disables it). */
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  /** Start step offered to bookers: hourly / half-hour / quarter-hour. */
  slotGranularityMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
});

export type TUpdateRoomSettingsInputSchema = z.infer<typeof ZUpdateRoomSettingsInputSchema>;
