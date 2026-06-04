import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZCreateBookingInputSchema } from "./createBooking.schema";
import { ZUpdateInvoiceSettingsInputSchema } from "./updateInvoiceSettings.schema";

export const roomsRouter = router({
  // Admin-only: update the issuer/company details printed on invoices.
  updateInvoiceSettings: authedAdminProcedure.input(ZUpdateInvoiceSettingsInputSchema).mutation(async ({ input }) => {
    const { getInvoiceSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/InvoiceSettingsRepository.container"
    );
    return getInvoiceSettingsRepository().update(input);
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
