import { z } from "zod";

/** The exhibitor changing their own sign-in address; the password confirms it is them. */
export const ZChangeMyEmailInputSchema = z.object({
  email: z.string().trim().min(3).max(255),
  password: z.string().min(1),
});

/** An admin correcting somebody's address — a typo taken down at the desk. */
export const ZChangeBookerEmailInputSchema = z.object({
  userId: z.number().int().positive(),
  email: z.string().trim().min(3).max(255),
});

export type TChangeMyEmailInputSchema = z.infer<typeof ZChangeMyEmailInputSchema>;
export type TChangeBookerEmailInputSchema = z.infer<typeof ZChangeBookerEmailInputSchema>;
