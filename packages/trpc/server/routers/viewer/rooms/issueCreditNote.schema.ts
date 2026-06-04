import { z } from "zod";

export const ZIssueCreditNoteInputSchema = z.object({
  uid: z.string().min(1),
});

export type TIssueCreditNoteInputSchema = z.infer<typeof ZIssueCreditNoteInputSchema>;
