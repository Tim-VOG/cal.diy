import { z } from "zod";

const ZEventDay = z
  .object({
    /** Calendar date in Europe/Brussels, YYYY-MM-DD. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** First bookable hour (inclusive), Brussels time. */
    openHourBrussels: z.number().int().min(0).max(23),
    /** Closing hour (exclusive): no slot may start at/after it. */
    closeHourBrussels: z.number().int().min(1).max(24),
  })
  .refine((d) => d.openHourBrussels < d.closeHourBrussels, {
    message: "Opening hour must be before closing hour",
  });

export const ZUpdateRoomSettingsInputSchema = z.object({
  /** Turnover buffer in minutes after each booking (0 disables it). */
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  /** Start step offered to bookers: hourly / half-hour / quarter-hour. */
  slotGranularityMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  /** Opening hours per event day (Brussels). Replaces the stored list. */
  eventDays: z.array(ZEventDay).min(1).optional(),
  /** Public landing title shown above "Book a meeting room" (empty clears it). */
  landingTitle: z.string().max(200).optional(),
  /** Public landing intro paragraph (empty clears it). */
  landingIntro: z.string().max(5000).optional(),
});

export type TUpdateRoomSettingsInputSchema = z.infer<typeof ZUpdateRoomSettingsInputSchema>;
