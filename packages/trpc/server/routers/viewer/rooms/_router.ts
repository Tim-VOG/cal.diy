import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZBookingUidInputSchema } from "./bookingUid.schema";
import { ZCreateBookingInputSchema } from "./createBooking.schema";
import { ZIssueCreditNoteInputSchema } from "./issueCreditNote.schema";
import { ZPreviewVatInputSchema } from "./previewVat.schema";
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

  // VAT recap for a live room selection, from the buyer's saved country/VAT —
  // shown on our page before the Stripe redirect.
  previewVat: authedProcedure.input(ZPreviewVatInputSchema).query(async ({ ctx, input }) => {
    const { getRoomVatPreviewService } = await import(
      "@calcom/features/ne26-rooms/di/RoomVatPreviewService.container"
    );
    return getRoomVatPreviewService().preview({
      userId: ctx.user.id,
      slug: input.slug,
      durationHours: input.durationHours,
      addOns: input.addOns,
    });
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

  // Admin-only: confirm a PENDING booking paid outside Stripe (e.g. bank
  // transfer), then issue its invoice (best-effort).
  confirmBookingManually: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    const confirmed = await getResourceBookingService().confirmManually(input.uid);
    if (confirmed) {
      const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
      await getInvoiceService().issueInvoice(input.uid);
    }
    return { confirmed };
  }),

  // Admin-only: cancel a PENDING booking without a credit note (test/no-show)
  // and free its slots. Paid bookings must use the credit-note flow instead.
  cancelPendingBooking: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    const cancelled = await getResourceBookingService().cancelPending(input.uid);
    return { cancelled };
  }),

  // Admin-only: re-send an already-issued invoice email to the booker.
  resendInvoice: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const sent = await getInvoiceService().resendInvoice(input.uid);
    return { sent };
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
    const { getNe26BillingProfileRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");

    // Our billing profile is the source of truth: it seeds the booking VAT and
    // mirrors into a Stripe Customer so Checkout opens pre-filled.
    const billingRepo = getNe26BillingProfileRepository();
    const profile = await billingRepo.findByUserId(ctx.user.id);

    let customerId: string | undefined;
    if (profile) {
      const existing = await billingRepo.findStripeCustomerId(ctx.user.id);
      customerId = await getStripeCheckoutService().ensureCustomer({
        customerId: existing,
        email: ctx.user.email,
        name: ctx.user.name,
        legalName: profile.legalName,
        country: profile.country,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        postalCode: profile.postalCode,
        city: profile.city,
      });
      if (customerId !== existing) await billingRepo.setStripeCustomerId(ctx.user.id, customerId);
    }

    const booking = await getResourceBookingService().createBooking({
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
      booker: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name ?? ctx.user.email },
      addOns: input.addOns,
      billing: profile
        ? { country: profile.country || null, vatNumber: profile.vatNumber || null }
        : undefined,
    });

    const checkout = await getStripeCheckoutService().createCheckoutSession({
      bookingUid: booking.uid,
      currency: booking.currency,
      lines: booking.checkoutLines,
      customerEmail: ctx.user.email,
      customerId,
      successUrl: `${WEBAPP_URL}/rooms/booked/${booking.uid}`,
      cancelUrl: `${WEBAPP_URL}/rooms/${input.slug}`,
    });

    return { ...booking, checkoutUrl: checkout.url };
  }),
});
