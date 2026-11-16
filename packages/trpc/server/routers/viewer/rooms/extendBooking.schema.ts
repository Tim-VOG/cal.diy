import { z } from "zod";

export const ZExtendBookingInputSchema = z.object({
  /** The paid booking being continued. */
  uid: z.string().min(1),
  /**
   * Which side the extra time goes on. "before" makes the meeting start
   * earlier and keeps its end; "after" keeps its start and runs it later.
   */
  direction: z.union([z.literal("before"), z.literal("after")]),
  /**
   * The continuation's own length, and what it is priced on. Room prices are
   * per duration and not proportional, so a continuation is charged the
   * ordinary package price for this length — there is no "price of a fourth
   * hour" to compute.
   */
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type TExtendBookingInputSchema = z.infer<typeof ZExtendBookingInputSchema>;
