import { z } from "zod";

export const ZAdminCreateBookingInputSchema = z.object({
  /**
   * The exhibitor being billed. No account is required: an admin sells to
   * whoever asked, and Stripe collects the postal address for the invoice.
   * Country and VAT number are asked here rather than left to Checkout,
   * because they decide the rate the invoice will carry.
   */
  exhibitorEmail: z.string().email(),
  exhibitorName: z.string().min(1).max(120),
  /** ISO-3166 alpha-2. */
  country: z.string().length(2),
  vatNumber: z.string().max(40).optional(),
  poNumber: z.string().max(60).optional(),
  internalReference: z.string().max(60).optional(),
  slug: z.string().min(1),
  startUtc: z.string().datetime(),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type TAdminCreateBookingInputSchema = z.infer<typeof ZAdminCreateBookingInputSchema>;
