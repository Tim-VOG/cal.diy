import { ROOM_ICON_NAMES } from "@calcom/features/ne26-rooms/lib/roomIcons";
import { z } from "zod";

/**
 * A room photo is either one of our uploads or a path under /public. Anything
 * else — a data: URL in particular — would be served from our own origin on a
 * page exhibitors browse. Admin-only, so this is a guard rail rather than a
 * defence, but the field had no shape at all.
 */
const imagePath = z
  .string()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), {
    message: "An image must be an uploaded file, a /path, or an https:// URL.",
  });

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
  imageUrl: imagePath.optional(),
  /** Up to 4 extra photos (URLs/paths) for the room detail gallery. */
  galleryImages: z.array(imagePath).max(4).optional(),
  /**
   * The glyph for a room with no photograph. Empty string clears it, which puts
   * the room back on the default for its category.
   */
  iconName: z
    .union([z.enum(ROOM_ICON_NAMES), z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .optional(),
  isActive: z.boolean().optional(),
});

export type TUpdateResourceInputSchema = z.infer<typeof ZUpdateResourceInputSchema>;
