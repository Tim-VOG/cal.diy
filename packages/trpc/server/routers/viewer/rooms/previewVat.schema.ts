import { z } from "zod";

export const ZPreviewVatInputSchema = z.object({
  slug: z.string().min(1),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  addOns: z.array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1) })).optional(),
});

export type TPreviewVatInputSchema = z.infer<typeof ZPreviewVatInputSchema>;
