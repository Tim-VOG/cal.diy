import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCreateBookingInputSchema } from "./createBooking.schema";
import { ZIssueCreditNoteInputSchema } from "./issueCreditNote.schema";
import { ZUpdateBillingProfileInputSchema } from "./updateBillingProfile.schema";
import { ZUpdateInvoiceSettingsInputSchema } from "./updateInvoiceSettings.schema";

export const roomsRouter = router({
  // The signed-in exhibitor's saved billing details (null until they fill them in).
  getBillingProfile: authedProcedure.query(async ({ ctx }) => {
    const { getNe26BillingProfileRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container"
    );
    return getNe26BillingProfileRepository().findByUserId(ctx.user.id);
  }),

  // Create or update the signed-in exhibitor's billing profile (reused at checkout).
  updateBillingProfile: authedProcedure
    .input(ZUpdateBillingProfileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { getNe26BillingProfileRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container"
      );
      return getNe26BillingProfileRepository().upsertByUserId(ctx.user.id, input);
    }),

  // Admin-only: update the issuer/company details printed on invoices.
  updateInvoiceSettings: authedAdminProcedure
    .input(ZUpdateInvoiceSettingsInputSchema)
    .mutation(async ({ input }) => {
      const { getInvoiceSettingsRepository } = await import(
        "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container"
      );
      return getInvoiceSettingsRepository().update(input);
    }),

  // Admin-only: cancel a confirmed booking and issue a credit note (manual full
  // refund flow). The Stripe refund itself is done in the Stripe dashboard; this
  // records the credit note, frees the room, and emails the booker.
  issueCreditNote: authedAdminProcedure.input(ZIssueCreditNoteInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const issued = await getInvoiceService().issueCreditNote(input.uid);
    return { issued };
  }),

  // Create a PENDING NE26 room booking with a temporary hold, then open a Stripe
  // Checkout session for it and return the URL to redirect the booker to.
  // Requires login; the booker identity comes from the session.
  createBooking: authedProcedure.input(ZCreateBookingInputSchema).mutation(async ({ ctx, input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    const { getStripeCheckoutService } = await import(
      "@calcom/features/ne26-rooms/di/StripeCheckoutService.container"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");

    const booking = await getResourceBookingService().createBooking({
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
      booker: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name ?? ctx.user.email },
      addOns: input.addOns,
    });

    const checkout = await getStripeCheckoutService().createCheckoutSession({
      bookingUid: booking.uid,
      currency: booking.currency,
      lines: booking.checkoutLines,
      customerEmail: ctx.user.email,
      successUrl: `${WEBAPP_URL}/rooms/booked/${booking.uid}`,
      cancelUrl: `${WEBAPP_URL}/rooms/${input.slug}`,
    });

    return { ...booking, checkoutUrl: checkout.url };
  }),
});
