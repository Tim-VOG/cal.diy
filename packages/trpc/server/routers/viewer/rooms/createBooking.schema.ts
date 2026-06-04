import { z } from "zod";

export const ZCreateBookingInputSchema = z.object({
  slug: z.string().min(1),
  /** Atomic slot start, ISO 8601 UTC. */
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Buyer billing country (ISO-3166 alpha-2) and optional intra-EU VAT number. */
  country: z.string().length(2),
  vatNumber: z.string().max(50).optional(),
  addOns: z.array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1) })).optional(),
});

export type TCreateBookingInputSchema = z.infer<typeof ZCreateBookingInputSchema>;
