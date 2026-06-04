import { z } from "zod";

export const ZUpdateResourceInputSchema = z.object({
  id: z.number().int().positive(),
  capacity: z.number().int().min(0).optional(),
  surface: z.number().int().min(0).optional(),
  /** Prices in cents. */
  price1h: z.number().int().min(0).optional(),
  price2h: z.number().int().min(0).optional(),
  price3h: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type TUpdateResourceInputSchema = z.infer<typeof ZUpdateResourceInputSchema>;
