import { z } from "zod";

export const ZCreateBookingInputSchema = z.object({
  slug: z.string().min(1),
  /** Atomic slot start, ISO 8601 UTC. */
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  // The bounds are a hard stop, not a business rule: an unbounded quantity lets a
  // PER_PERSON add-on build an absurd Stripe total, and past ~600k it overflows
  // the int4 lineTotal column into an unhandled 500. The real per-room limit is
  // enforced server-side against the room's capacity.
  addOns: z
    .array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1).max(500) }))
    .max(20)
    .optional(),
});

export type TCreateBookingInputSchema = z.infer<typeof ZCreateBookingInputSchema>;
