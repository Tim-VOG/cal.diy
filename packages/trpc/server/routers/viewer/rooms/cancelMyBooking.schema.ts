import { z } from "zod";

/** One room, by its booking uid: a payment may cover several. */
export const ZCancelMyBookingInputSchema = z.object({
  uid: z.string().min(1),
});

export type TCancelMyBookingInputSchema = z.infer<typeof ZCancelMyBookingInputSchema>;
