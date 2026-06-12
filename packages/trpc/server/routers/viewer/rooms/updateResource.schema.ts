import { z } from "zod";

export const ZUpdateResourceInputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  category: z.enum(["PREMIUM", "INTERMEDIATE", "ENTRY"]).optional(),
  capacity: z.number().int().min(0).optional(),
  surface: z.number().int().min(0).optional(),
  /** Prices in cents. */
  price1h: z.number().int().min(0).optional(),
  price2h: z.number().int().min(0).optional(),
  price3h: z.number().int().min(0).optional(),
  /** URL or /public path for the room card image. */
  imageUrl: z.string().max(500).optional(),
  /** Up to 4 extra photos (URLs/paths) for the room detail gallery. */
  galleryImages: z.array(z.string().max(500)).max(4).optional(),
  isActive: z.boolean().optional(),
});

export type TUpdateResourceInputSchema = z.infer<typeof ZUpdateResourceInputSchema>;
