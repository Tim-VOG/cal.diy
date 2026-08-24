import { z } from "zod";

export const ZUpdateBillingProfileInputSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  legalName: z.string().max(200).optional(),
  vatNumber: z.string().max(40).optional(),
  poNumber: z.string().max(60).optional(),
  internalReference: z.string().max(60).optional(),
  /** ISO-3166 alpha-2 country code. */
  country: z.string().max(2).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  postalCode: z.string().max(20).optional(),
  city: z.string().max(120).optional(),
});

export type TUpdateBillingProfileInputSchema = z.infer<typeof ZUpdateBillingProfileInputSchema>;
