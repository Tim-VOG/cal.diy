import { z } from "zod";

export const ZBookingUidInputSchema = z.object({
  uid: z.string().min(1),
});

export type TBookingUidInputSchema = z.infer<typeof ZBookingUidInputSchema>;
