import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

export const ZCreateLegalPageInputSchema = z.object({
  slug,
  title: z.string().min(1).max(200),
  content: z.string().max(50000).default(""),
  published: z.boolean().default(false),
});
export type TCreateLegalPageInputSchema = z.infer<typeof ZCreateLegalPageInputSchema>;

export const ZUpdateLegalPageInputSchema = z.object({
  id: z.number().int().positive(),
  slug: slug.optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  published: z.boolean().optional(),
});
export type TUpdateLegalPageInputSchema = z.infer<typeof ZUpdateLegalPageInputSchema>;

export const ZDeleteLegalPageInputSchema = z.object({ id: z.number().int().positive() });
export type TDeleteLegalPageInputSchema = z.infer<typeof ZDeleteLegalPageInputSchema>;
