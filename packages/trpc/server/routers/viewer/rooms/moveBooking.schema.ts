import { z } from "zod";

export const ZMoveBookingInputSchema = z.object({
  /** The booking being moved. Same room, same length — only the clock changes. */
  uid: z.string().min(1),
  /** Where it goes, as an ISO instant on a slot boundary. */
  newStartUtc: z.string().datetime(),
  /**
   * Whether the exhibitor is told. Default on, and worth turning off only when
   * they are standing at the counter having just asked for the change.
   */
  notify: z.boolean().default(true),
});

export type TMoveBookingInputSchema = z.infer<typeof ZMoveBookingInputSchema>;
