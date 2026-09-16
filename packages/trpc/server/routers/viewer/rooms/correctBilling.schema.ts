import { z } from "zod";

const field = (max: number) => z.string().trim().max(max);

/** Who an order is billed to. Only these fields; everything else on the order is out of reach. */
export const ZCorrectBillingInputSchema = z
  .object({
    uid: z.string().min(1),
    companyName: field(200),
    firstName: field(100),
    lastName: field(100),
    addressLine1: field(200),
    addressLine2: field(200),
    postalCode: field(30),
    city: field(100),
    region: field(100),
    /** Email the corrected invoice to the buyer once it is rendered. */
    emailBuyer: z.boolean().default(false),
  })
  .refine((v) => v.firstName.length > 0 || v.lastName.length > 0, {
    message: "A contact name is required.",
    path: ["firstName"],
  });

export type TCorrectBillingInputSchema = z.infer<typeof ZCorrectBillingInputSchema>;
