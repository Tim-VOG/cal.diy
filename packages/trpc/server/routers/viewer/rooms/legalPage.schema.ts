import { z } from "zod";

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

/**
 * Where the page sends people instead of showing content. Empty clears it.
 *
 * Restricted to http(s) on purpose. This value ends up in a redirect and in an
 * anchor in the admin, and a "javascript:" address in an href is a script an
 * administrator would be running against their own session. Nothing about the
 * feature needs any other scheme.
 */
const externalUrl = z
  .string()
  .max(2000)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full web address starting with http:// or https://");

export const ZCreateLegalPageInputSchema = z.object({
  slug,
  title: z.string().min(1).max(200),
  content: z.string().max(50000).default(""),
  externalUrl: externalUrl.optional(),
  published: z.boolean().default(false),
});
export type TCreateLegalPageInputSchema = z.infer<typeof ZCreateLegalPageInputSchema>;

export const ZUpdateLegalPageInputSchema = z.object({
  id: z.number().int().positive(),
  slug: slug.optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  externalUrl: externalUrl.optional(),
  published: z.boolean().optional(),
});
export type TUpdateLegalPageInputSchema = z.infer<typeof ZUpdateLegalPageInputSchema>;

export const ZDeleteLegalPageInputSchema = z.object({ id: z.number().int().positive() });
export type TDeleteLegalPageInputSchema = z.infer<typeof ZDeleteLegalPageInputSchema>;
