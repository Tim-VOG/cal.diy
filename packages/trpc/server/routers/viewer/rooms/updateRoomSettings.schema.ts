import { z } from "zod";

export const ZUpdateRoomSettingsInputSchema = z.object({
  /** Turnover buffer in minutes after each booking (0 disables it). */
  bufferMinutes: z.number().int().min(0).max(240),
});

export type TUpdateRoomSettingsInputSchema = z.infer<typeof ZUpdateRoomSettingsInputSchema>;
