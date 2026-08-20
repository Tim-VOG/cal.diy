import { TRPCError } from "@trpc/server";
import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZBookingUidInputSchema } from "./bookingUid.schema";
import { ZCreateBlockInputSchema } from "./createBlock.schema";
import { ZCreateBookingInputSchema } from "./createBooking.schema";
import { ZIssueCreditNoteInputSchema } from "./issueCreditNote.schema";
import {
  ZCreateLegalPageInputSchema,
  ZDeleteLegalPageInputSchema,
  ZUpdateLegalPageInputSchema,
} from "./legalPage.schema";
import { ZPreviewVatInputSchema } from "./previewVat.schema";
import {
  ZCreateAddOnInputSchema,
  ZDeleteAddOnInputSchema,
  ZUpdateAddOnInputSchema,
} from "./updateAddOn.schema";
import { ZUpdateBillingProfileInputSchema } from "./updateBillingProfile.schema";
import { ZUpdateInvoiceSettingsInputSchema } from "./updateInvoiceSettings.schema";
import { ZUpdateResourceInputSchema } from "./updateResource.schema";
import { ZUpdateRoomSettingsInputSchema } from "./updateRoomSettings.schema";

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

  // Admin-only: issue the invoice for a CONFIRMED booking that never got one —
  // the PDF render or the disk write failed at payment time and the webhook only
  // logged it. Without this the booking is a dead end: it can't be invoiced,
  // can't be credited (that needs an invoice number) and can't be cancelled
  // (that path is PENDING-only), so its room stays held until someone edits the
  // database by hand. issueInvoice is idempotent, so this is safe to retry.
  issueInvoice: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    await getInvoiceService().issueInvoice(input.uid);
    const booking = await getResourceBookingRepository().findByUid(input.uid);
    return { issued: Boolean(booking?.invoiceNumber) };
  }),

  // Admin-only: re-send an already-issued invoice email to the booker.
  resendInvoice: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const sent = await getInvoiceService().resendInvoice(input.uid);
    return { sent };
  }),

  // Admin-only: list every room (active + inactive) for management.
  listResources: authedAdminProcedure.query(async () => {
    const { getResourceRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceRepository.container"
    );
    return getResourceRepository().findAllForAdmin();
  }),

  // Admin-only: update booking settings (turnover buffer between bookings).
  updateRoomSettings: authedAdminProcedure
    .input(ZUpdateRoomSettingsInputSchema)
    .mutation(async ({ input }) => {
      const { getNe26RoomSettingsRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
      );
      return getNe26RoomSettingsRepository().update(input);
    }),

  // Admin-only: update a room's prices / capacity / surface / active state.
  updateResource: authedAdminProcedure.input(ZUpdateResourceInputSchema).mutation(async ({ input }) => {
    const { getResourceRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceRepository.container"
    );
    const { id, ...data } = input;
    return getResourceRepository().update(id, data);
  }),

  // Admin-only: list every add-on (active + inactive) for management.
  listAddOns: authedAdminProcedure.query(async () => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    return getAddOnRepository().findAllForAdmin();
  }),

  // Admin-only: update an add-on's name / price / VAT rate / type / active state.
  updateAddOn: authedAdminProcedure.input(ZUpdateAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    const { id, ...data } = input;
    return getAddOnRepository().update(id, data);
  }),

  // Admin-only: create a new add-on (slug derived from the name).
  createAddOn: authedAdminProcedure.input(ZCreateAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    const slugify = (await import("@calcom/lib/slugify")).default;
    return getAddOnRepository().create({ ...input, slug: slugify(input.name) });
  }),

  // Admin-only: delete an add-on (refused if used by bookings — deactivate instead).
  deleteAddOn: authedAdminProcedure.input(ZDeleteAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    await getAddOnRepository().delete(input.id);
    return { deleted: true };
  }),

  // Admin-only: list all legal / informational pages (published + drafts).
  listLegalPages: authedAdminProcedure.query(async () => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    return getNe26LegalPageRepository().findAllForAdmin();
  }),

  // Admin-only: create a legal page.
  createLegalPage: authedAdminProcedure.input(ZCreateLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    return getNe26LegalPageRepository().create(input);
  }),

  // Admin-only: update a legal page's slug / title / content / published state.
  updateLegalPage: authedAdminProcedure.input(ZUpdateLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    const { id, ...data } = input;
    return getNe26LegalPageRepository().update(id, data);
  }),

  // Admin-only: delete a legal page.
  deleteLegalPage: authedAdminProcedure.input(ZDeleteLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    await getNe26LegalPageRepository().delete(input.id);
    return { deleted: true };
  }),

  // Admin-only: current room blocks (maintenance / internal use).
  listBlocks: authedAdminProcedure.query(async () => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    return getResourceBookingService().listBlocks();
  }),

  // Admin-only: block a room on a slot (rejected if it overlaps a booking).
  createBlock: authedAdminProcedure.input(ZCreateBlockInputSchema).mutation(async ({ input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    await getResourceBookingService().createBlock({
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
    });
    return { created: true };
  }),

  // Admin-only: remove a room block and free its slots.
  removeBlock: authedAdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    const removed = await getResourceBookingService().removeBlock(input.uid);
    return { removed };
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

    // Billing details are printed on the invoice, so they're required to book.
    const { isBillingProfileComplete } = await import("@calcom/features/ne26-rooms/lib/billing");
    if (!isBillingProfileComplete(profile)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Please complete your billing details before booking — they appear on your invoice.",
      });
    }

    let customerId: string | undefined;
    if (profile) {
      const existing = await billingRepo.findStripeCustomerId(ctx.user.id);
      customerId = await getStripeCheckoutService().ensureCustomer({
        customerId: existing,
        email: ctx.user.email,
        // The profile owns the contact name; the session copy can still be the
        // pre-save value when the exhibitor books straight after completing it.
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || ctx.user.name,
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
      booker: {
        userId: ctx.user.id,
        email: ctx.user.email,
        name:
          [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
          ctx.user.name ||
          ctx.user.email,
      },
      addOns: input.addOns,
      billing: profile
        ? { country: profile.country || null, vatNumber: profile.vatNumber || null }
        : undefined,
    });

    // Prices are HT (excl. VAT): add VAT lines so Stripe charges TTC. VAT is
    // resolved from the buyer's profile + the admin matrix (reverse charge -> none).
    const { getRoomVatPreviewService } = await import(
      "@calcom/features/ne26-rooms/di/RoomVatPreviewService.container"
    );
    const vat = await getRoomVatPreviewService().preview({
      userId: ctx.user.id,
      slug: input.slug,
      durationHours: input.durationHours,
      addOns: input.addOns,
    });
    const vatLines = vat.vatBreakdown
      .filter((v) => v.vat > 0)
      .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat }));

    // The hold is already committed at this point. If Stripe can't give us a
    // Checkout URL, release it immediately: otherwise the buyer gets a raw SDK
    // string ("Request timed out") AND their slot stays locked for the length of
    // the hold, unbookable by them or anyone else.
    let checkout: { url: string };
    try {
      checkout = await getStripeCheckoutService().createCheckoutSession({
        bookingUid: booking.uid,
        currency: booking.currency,
        lines: [...booking.checkoutLines, ...vatLines],
        customerEmail: ctx.user.email,
        customerId,
        holdExpiresAt: booking.holdExpiresAt,
        successUrl: `${WEBAPP_URL}/rooms/booked/${booking.uid}`,
        cancelUrl: `${WEBAPP_URL}/rooms/${input.slug}`,
      });
    } catch (e) {
      await getResourceBookingService()
        .cancelPending(booking.uid)
        .catch(() => {
          // Releasing is best-effort; the hold expires on its own either way.
        });
      const { ErrorCode: EC } = await import("@calcom/lib/errorCodes");
      const { ErrorWithCode: EWC } = await import("@calcom/lib/errors");
      throw new EWC(
        EC.InternalServerError,
        "We couldn't reach our payment provider. Nothing was charged and your slot is free again — please try once more."
      );
    }

    return { ...booking, checkoutUrl: checkout.url };
  }),

  // Resume an abandoned PENDING booking: rebuild its checkout and return the URL.
  resumeBooking: authedProcedure.input(ZBookingUidInputSchema).mutation(async ({ ctx, input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    const { getStripeCheckoutService } = await import(
      "@calcom/features/ne26-rooms/di/StripeCheckoutService.container"
    );
    const { getNe26BillingProfileRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26BillingProfileRepository.container"
    );
    const { getRoomVatPreviewService } = await import(
      "@calcom/features/ne26-rooms/di/RoomVatPreviewService.container"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");

    const resume = await getResourceBookingService().prepareResume(input.uid, ctx.user.id);

    const billingRepo = getNe26BillingProfileRepository();
    const profile = await billingRepo.findByUserId(ctx.user.id);
    let customerId: string | undefined;
    if (profile) {
      const existing = await billingRepo.findStripeCustomerId(ctx.user.id);
      customerId = await getStripeCheckoutService().ensureCustomer({
        customerId: existing,
        email: ctx.user.email,
        // The profile owns the contact name; the session copy can still be the
        // pre-save value when the exhibitor books straight after completing it.
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || ctx.user.name,
        legalName: profile.legalName,
        country: profile.country,
        addressLine1: profile.addressLine1,
        addressLine2: profile.addressLine2,
        postalCode: profile.postalCode,
        city: profile.city,
      });
      if (customerId !== existing) await billingRepo.setStripeCustomerId(ctx.user.id, customerId);
    }

    const vat = await getRoomVatPreviewService().preview({
      userId: ctx.user.id,
      slug: resume.slug,
      durationHours: resume.durationHours,
      addOns: resume.addOns,
    });
    const vatLines = vat.vatBreakdown
      .filter((v) => v.vat > 0)
      .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat }));

    const checkout = await getStripeCheckoutService().createCheckoutSession({
      bookingUid: input.uid,
      currency: resume.currency,
      lines: [...resume.checkoutLines, ...vatLines],
      customerEmail: ctx.user.email,
      customerId,
      holdExpiresAt: resume.holdExpiresAt,
      successUrl: `${WEBAPP_URL}/rooms/booked/${input.uid}`,
      cancelUrl: `${WEBAPP_URL}/rooms/bookings`,
    });

    return { checkoutUrl: checkout.url };
  }),
});
