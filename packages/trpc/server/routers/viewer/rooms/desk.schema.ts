import { z } from "zod";

export const ZDeskDayInputSchema = z.object({
  /** Calendar day in Europe/Brussels, "YYYY-MM-DD". */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type TDeskDayInputSchema = z.infer<typeof ZDeskDayInputSchema>;

export const ZDeskSearchInputSchema = z.object({
  query: z.string().min(2).max(120),
});
export type TDeskSearchInputSchema = z.infer<typeof ZDeskSearchInputSchema>;

export const ZDeskCheckInInputSchema = z.object({
  uid: z.string().min(1),
  /** false undoes a check-in entered by mistake. */
  arrived: z.boolean(),
});
export type TDeskCheckInInputSchema = z.infer<typeof ZDeskCheckInInputSchema>;

export const ZDeskCreateBookingInputSchema = z.object({
  /** The exhibitor being billed. They must already have an account. */
  exhibitorEmail: z.string().email(),
  slug: z.string().min(1),
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  addOns: z.array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1) })).optional(),
});
export type TDeskCreateBookingInputSchema = z.infer<typeof ZDeskCreateBookingInputSchema>;
