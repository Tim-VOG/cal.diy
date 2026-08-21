import { z } from "zod";

export const ZGrantRoleInputSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "HOSTESS"]),
});
export type TGrantRoleInputSchema = z.infer<typeof ZGrantRoleInputSchema>;

export const ZRevokeRoleInputSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["ADMIN", "HOSTESS"]),
});
export type TRevokeRoleInputSchema = z.infer<typeof ZRevokeRoleInputSchema>;
