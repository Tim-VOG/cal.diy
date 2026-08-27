import { z } from "zod";

const priceType = z.enum(["FLAT", "PER_PERSON", "PER_HOUR"]);

export const ZUpdateAddOnInputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  priceType: priceType.optional(),
  /** Unit price in cents. */
  price: z.number().int().min(0).optional(),
  /** VAT rate in basis points (e.g. 2100 = 21%). */
  vatRate: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
  /**
   * Serving hours, in minutes from event-local midnight (660 = 11:00). Null
   * clears the window, putting the add-on back on sale all day. Nullable rather
   * than merely optional, because "leave unchanged" and "available all day"
   * have to be different instructions.
   */
  availableFromMinute: z.number().int().min(0).max(1439).nullable().optional(),
  availableToMinute: z.number().int().min(1).max(1440).nullable().optional(),
});
export type TUpdateAddOnInputSchema = z.infer<typeof ZUpdateAddOnInputSchema>;

export const ZCreateAddOnInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  priceType,
  price: z.number().int().min(0),
  vatRate: z.number().int().min(0).max(10000),
});
export type TCreateAddOnInputSchema = z.infer<typeof ZCreateAddOnInputSchema>;

export const ZDeleteAddOnInputSchema = z.object({ id: z.number().int().positive() });
export type TDeleteAddOnInputSchema = z.infer<typeof ZDeleteAddOnInputSchema>;
