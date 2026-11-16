import { z } from "zod";

export const ZCreateBlockInputSchema = z.object({
  slug: z.string().min(1),
  /** Atomic slot start, ISO 8601 UTC. */
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /**
   * Why the room is off sale. Optional, but the field exists because a block
   * with no reason is indistinguishable from one made by mistake — which is
   * the question a hostess has to answer with an exhibitor in front of her.
   */
  note: z.string().trim().max(200).optional(),
});

export type TCreateBlockInputSchema = z.infer<typeof ZCreateBlockInputSchema>;
