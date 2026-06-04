import { z } from "zod";

export const ZUpdateAddOnInputSchema = z.object({
  id: z.number().int().positive(),
  /** Unit price in cents. */
  price: z.number().int().min(0).optional(),
  /** VAT rate in basis points (e.g. 2100 = 21%). */
  vatRate: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

export type TUpdateAddOnInputSchema = z.infer<typeof ZUpdateAddOnInputSchema>;
