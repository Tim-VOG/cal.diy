import { z } from "zod";

export const ZCreateBlockInputSchema = z.object({
  slug: z.string().min(1),
  /** Atomic slot start, ISO 8601 UTC. */
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type TCreateBlockInputSchema = z.infer<typeof ZCreateBlockInputSchema>;
