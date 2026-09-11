import { z } from "zod";

export const ZUpdateInvoiceSettingsInputSchema = z.object({
  legalName: z.string().max(200),
  vatNumber: z.string().max(50),
  addressLine1: z.string().max(200),
  addressLine2: z.string().max(200),
  postalCode: z.string().max(20),
  city: z.string().max(100),
  country: z.string().max(100),
  iban: z.string().max(50),
  bic: z.string().max(20),
  contactEmail: z.string().max(200),
  /** Comma-separated sales recipients — a booking sold, declined or refunded.
   *  Empty falls back to technicalEmails, then contactEmail. */
  notifyEmails: z.string().max(500),
  /** Comma-separated recipients for the alerts only Stripe or database access
   *  can resolve. Empty falls back to notifyEmails. */
  technicalEmails: z.string().max(500),
  legalFooter: z.string().max(500),
  footerColumn1: z.string().max(500),
  footerColumn2: z.string().max(500),
  footerColumn3: z.string().max(500),
  vatOnlyForBelgium: z.boolean().optional(),
  euReverseChargeEnabled: z.boolean(),
  euReverseChargeMention: z.string().max(300),
  nonEuExemptEnabled: z.boolean(),
  nonEuExemptMention: z.string().max(300),
});

export type TUpdateInvoiceSettingsInputSchema = z.infer<typeof ZUpdateInvoiceSettingsInputSchema>;
