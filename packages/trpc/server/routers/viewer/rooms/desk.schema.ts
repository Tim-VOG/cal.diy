import { z } from "zod";

export const ZDeskDayInputSchema = z.object({
  /** Calendar day in Europe/Istanbul, "YYYY-MM-DD". */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type TDeskDayInputSchema = z.infer<typeof ZDeskDayInputSchema>;

export const ZDeskSearchInputSchema = z.object({
  query: z.string().min(2).max(120),
});
export type TDeskSearchInputSchema = z.infer<typeof ZDeskSearchInputSchema>;

export const ZDeskCheckInInputSchema = z.object({
  uid: z.string().min(1),
  /** false undoes a check-in entered by mistake. */
  arrived: z.boolean(),
});
export type TDeskCheckInInputSchema = z.infer<typeof ZDeskCheckInInputSchema>;

export const ZDeskCreateBookingInputSchema = z.object({
  /**
   * The exhibitor being billed. No account is required — the desk sells to
   * whoever is at the counter, and Stripe collects the postal address for the
   * invoice. Country and VAT number are asked here rather than left to
   * Checkout, because they decide the rate that is about to be charged.
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
  // Bounded like every other entry point: an unbounded quantity lets a crafted
  // request build an order total large enough to overflow a currency amount.
  addOns: z
    .array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1).max(500) }))
    .optional(),
});
export type TDeskCreateBookingInputSchema = z.infer<typeof ZDeskCreateBookingInputSchema>;

export const ZDeskCancellationRequestInputSchema = z.object({
  uid: z.string().min(1),
  /**
   * What the exhibitor said, in the hostess's words. Optional and short: it is
   * context for whoever decides, not a case file.
   */
  note: z.string().max(400).optional(),
});
export type TDeskCancellationRequestInputSchema = z.infer<typeof ZDeskCancellationRequestInputSchema>;

export const ZDeskResumePaymentInputSchema = z.object({
  /** The room whose unpaid order needs its payment page again. */
  uid: z.string().min(1),
  /** true mails the link to the exhibitor instead of opening it on the tablet. */
  email: z.boolean().optional(),
});
export type TDeskResumePaymentInputSchema = z.infer<typeof ZDeskResumePaymentInputSchema>;

export const ZDeskQuoteInputSchema = z.object({
  slug: z.string().min(1),
  durationHours: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  startUtc: z.string().datetime().optional(),
  addOns: z
    .array(z.object({ slug: z.string().min(1), quantity: z.number().int().min(1).max(500) }))
    .max(20)
    .optional(),
  /**
   * Typed at the counter, not read from an account: it is what decides the VAT
   * the exhibitor is about to be charged.
   */
  country: z.string().length(2).optional(),
  vatNumber: z.string().max(40).optional(),
});
export type TDeskQuoteInputSchema = z.infer<typeof ZDeskQuoteInputSchema>;
