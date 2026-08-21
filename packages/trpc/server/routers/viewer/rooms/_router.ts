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
  ZDeskCheckInInputSchema,
  ZDeskCreateBookingInputSchema,
  ZDeskDayInputSchema,
  ZDeskSearchInputSchema,
} from "./desk.schema";
import { ZGrantRoleInputSchema, ZRevokeRoleInputSchema } from "./staff.schema";
import {
  ZCreateAddOnInputSchema,
  ZDeleteAddOnInputSchema,
  ZUpdateAddOnInputSchema,
} from "./updateAddOn.schema";
import { ZUpdateBillingProfileInputSchema } from "./updateBillingProfile.schema";
import { ZUpdateInvoiceSettingsInputSchema } from "./updateInvoiceSettings.schema";
import { ZUpdateResourceInputSchema } from "./updateResource.schema";
import { ZUpdateRoomSettingsInputSchema } from "./updateRoomSettings.schema";

/**
 * The welcome desk is open to hostesses and to admins (who work it during the
 * event and can already do strictly more). Checked per procedure rather than in
 * a shared middleware so the rule stays inside the NE26 feature instead of in
 * Cal's procedure layer.
 */
async function requireDesk(ctx: { user: { id: number; email: string; role?: string | null } }) {
  const { getNe26StaffRepository } = await import(
    "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
  );
  const { canWorkTheDesk, roleOf } = await import("@calcom/features/ne26-rooms/lib/staff");
  const repo = getNe26StaffRepository();
  const staffRole = ctx.user.role === "ADMIN" ? null : await repo.findStaffRole(ctx.user.id);
  const principal = {
    userId: ctx.user.id,
    email: ctx.user.email,
    calRole: ctx.user.role,
    staffRole,
  };
  if (!canWorkTheDesk(principal)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The welcome desk is for event staff." });
  }
  return { repo, principal, role: roleOf(principal) };
}

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

  // ---- Welcome desk (hostess + admin) ----

  deskDay: authedProcedure.input(ZDeskDayInputSchema).query(async ({ ctx, input }) => {
    await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    const { brusselsDayBounds } = await import("@calcom/features/ne26-rooms/lib/deskDay");
    const { fromUtc, toUtc } = brusselsDayBounds(input.date);
    return getResourceBookingRepository().findForDesk(fromUtc, toUtc);
  }),

  /** Rooms and their free start times, for selling at the counter. */
  deskAvailability: authedProcedure.query(async ({ ctx }) => {
    await requireDesk(ctx);
    const { getRoomAvailabilityService } = await import(
      "@calcom/features/ne26-rooms/di/RoomAvailabilityService.container"
    );
    const { getAddOnRepository } = await import(
      "@calcom/features/ne26-rooms/di/AddOnRepository.container"
    );
    const service = getRoomAvailabilityService();
    const rooms = await service.getActiveRooms();
    const [availability, addOns] = await Promise.all([
      Promise.all(rooms.map((room) => service.getAvailabilityBySlug(room.slug))),
      getAddOnRepository().findManyActive(),
    ]);
    return { rooms: availability, addOns };
  }),

  deskSearch: authedProcedure.input(ZDeskSearchInputSchema).query(async ({ ctx, input }) => {
    await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    return getResourceBookingRepository().searchForDesk(input.query);
  }),

  deskCheckIn: authedProcedure.input(ZDeskCheckInInputSchema).mutation(async ({ ctx, input }) => {
    const { repo, principal, role } = await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    const changed = await getResourceBookingRepository().setCheckedIn(
      input.uid,
      input.arrived ? new Date() : null,
      input.arrived ? principal.email : null
    );
    if (!changed) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "That booking is not confirmed, so it cannot be checked in.",
      });
    }
    await repo.recordAction({
      actorUserId: principal.userId,
      actorEmail: principal.email,
      actorRole: role,
      action: input.arrived ? "booking.checkin" : "booking.checkin.undo",
      targetType: "booking",
      targetId: input.uid,
      detail: input.arrived ? "Marked as arrived" : "Cleared a check-in",
    });
    return { ok: true };
  }),

  /**
   * Sell a room to someone standing at the counter.
   *
   * Runs through the same startCheckout() path an exhibitor uses on their own
   * phone, so the billing gate, the VAT lines and the hold-release-on-failure
   * behave identically. The hostess never handles a card: this returns the
   * Stripe Checkout URL for the exhibitor to complete.
   */
  deskCreateBooking: authedProcedure
    .input(ZDeskCreateBookingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { repo, principal, role } = await requireDesk(ctx);
      const target = await repo.findUserByEmail(input.exhibitorEmail);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No account with that email. Ask them to sign up first — it takes a minute.",
        });
      }

      const { startCheckout } = await import("@calcom/features/ne26-rooms/services/startCheckout");
      const { WEBAPP_URL } = await import("@calcom/lib/constants");
      const booking = await startCheckout({
        buyer: { userId: target.id, email: target.email, name: target.name },
        slug: input.slug,
        startUtc: new Date(input.startUtc),
        durationHours: input.durationHours,
        addOns: input.addOns,
        webappUrl: WEBAPP_URL,
        cancelPath: "/rooms/desk",
      });

      await repo.recordAction({
        actorUserId: principal.userId,
        actorEmail: principal.email,
        actorRole: role,
        action: "booking.create",
        targetType: "booking",
        targetId: booking.uid,
        detail: `Started a booking for ${target.email} — awaiting payment`,
      });
      return booking;
    }),

  // Admin-only: who holds a role, and the trail of what staff have done.
  staff: authedAdminProcedure.query(async () => {
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const repo = getNe26StaffRepository();
    const [members, actions] = await Promise.all([repo.listStaff(), repo.listRecentActions()]);
    return { members, actions };
  }),

  grantRole: authedAdminProcedure.input(ZGrantRoleInputSchema).mutation(async ({ ctx, input }) => {
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const repo = getNe26StaffRepository();
    const target = await repo.findUserByEmail(input.email);
    if (!target) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No account with that email. They have to sign up first.",
      });
    }

    if (input.role === "ADMIN") await repo.setCalRole(target.id, "ADMIN");
    else await repo.grantHostess(target.id, ctx.user.id);

    await repo.recordAction({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "ADMIN",
      action: "role.grant",
      targetType: "user",
      targetId: String(target.id),
      detail: `Granted ${input.role} to ${target.email}`,
    });
    return { userId: target.id, email: target.email };
  }),

  revokeRole: authedAdminProcedure.input(ZRevokeRoleInputSchema).mutation(async ({ ctx, input }) => {
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const repo = getNe26StaffRepository();

    if (input.role === "ADMIN") {
      // Removing the last administrator locks everyone out of settings, pricing
      // and refunds, with no way back in through the app.
      if ((await repo.countAdmins()) <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This is the last administrator. Grant admin to someone else first.",
        });
      }
      await repo.setCalRole(input.userId, "USER");
    } else {
      await repo.revokeStaffRole(input.userId);
    }

    await repo.recordAction({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "ADMIN",
      action: "role.revoke",
      targetType: "user",
      targetId: String(input.userId),
      detail: `Revoked ${input.role}`,
    });
    return { ok: true };
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
    const { startCheckout } = await import("@calcom/features/ne26-rooms/services/startCheckout");
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return startCheckout({
      buyer: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
      addOns: input.addOns,
      webappUrl: WEBAPP_URL,
      cancelPath: `/rooms/${input.slug}`,
    });
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
