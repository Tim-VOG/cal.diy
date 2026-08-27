import { TRPCError } from "@trpc/server";
import { z } from "zod";
import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZBookingUidInputSchema } from "./bookingUid.schema";
import { ZCreateBlockInputSchema } from "./createBlock.schema";
import { ZCreateBookingInputSchema, ZCreateOrderInputSchema } from "./createBooking.schema";
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
 * While desk mode is on, this session may not administer anything.
 *
 * The welcome-desk tablet is signed in as an administrator, so hiding the admin
 * buttons would be theatre: typing the URL would still work. Refusing here is
 * what makes the PIN meaningful — every administrative procedure is closed for
 * as long as the desk cookie is present, and only the PIN clears it.
 */
/** Admin-only, and refused outright while the session is locked to the desk. */
const ne26AdminProcedure = authedAdminProcedure.use(async ({ ctx, next }) => {
  const { deskSessionFromCookieHeader } = await import(
    "@calcom/features/ne26-rooms/lib/deskSession"
  );
  const header = (ctx as { req?: { headers?: Record<string, unknown> } }).req?.headers?.cookie;
  const desk = deskSessionFromCookieHeader(typeof header === "string" ? header : null);
  if (desk) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This tablet is in desk mode. Enter the PIN to leave it before changing anything.",
    });
  }
  return next();
});

/**
 * The welcome desk is open to hostesses and to admins (who work it during the
 * event and can already do strictly more). Checked per procedure rather than in
 * a shared middleware so the rule stays inside the NE26 feature instead of in
 * Cal's procedure layer.
 */
async function requireDesk(ctx: {
  user: { id: number; email: string; role?: string | null };
  req?: { headers?: Record<string, unknown> };
}) {
  const { getNe26StaffRepository } = await import(
    "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
  );
  const { canWorkTheDesk, roleOf } = await import("@calcom/features/ne26-rooms/lib/staff");
  const { deskSessionFromCookieHeader } = await import(
    "@calcom/features/ne26-rooms/lib/deskSession"
  );
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

  // In desk mode the account is the shared tablet, so the account's email says
  // nothing useful. The name entered when desk mode was started is who actually
  // did this, and it is what the trail should carry.
  const header = ctx.req?.headers?.cookie;
  const desk = deskSessionFromCookieHeader(typeof header === "string" ? header : null);
  const actorEmail = desk ? desk.hostessName : principal.email;
  const role = desk ? "HOSTESS" : roleOf(principal);

  return { repo, principal, role, actorEmail };
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
    const { eventDayBounds } = await import("@calcom/features/ne26-rooms/lib/deskDay");
    const { fromUtc, toUtc } = eventDayBounds(input.date);
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
    const [availability, addOns] = await Promise.all([
      getRoomAvailabilityService().getAvailabilityForAllRooms(),
      getAddOnRepository().findManyActive(),
    ]);
    return { rooms: availability, addOns };
  }),

  /**
   * The planning board: every room across one day, with what occupies it.
   *
   * Returns the day's 15-minute marks so the client draws exactly the columns
   * the schedule actually opens, rather than assuming a window and disagreeing
   * with availability at the edges.
   */
  deskPlanning: authedProcedure.input(ZDeskDayInputSchema).query(async ({ ctx, input }) => {
    await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    const { getResourceRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceRepository.container"
    );
    const { getNe26RoomSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
    );
    const { eventDayBounds } = await import("@calcom/features/ne26-rooms/lib/deskDay");
    const { buildEventSchedule } = await import("@calcom/features/ne26-rooms/lib/eventSchedule");

    const { fromUtc, toUtc } = eventDayBounds(input.date);
    const now = new Date();
    const [rooms, settings, bookings] = await Promise.all([
      getResourceRepository().findManyActive(),
      getNe26RoomSettingsRepository().get(),
      getResourceBookingRepository().findForPlanning(fromUtc, toUtc, now),
    ]);

    const day = buildEventSchedule(settings.eventDays).find((d) => d.date === input.date);
    return {
      date: input.date,
      bufferMinutes: settings.bufferMinutes,
      nowUtc: now.toISOString(),
      slotMarksUtc: (day?.openSlotStartsUtc ?? []).map((d) => d.toISOString()),
      rooms: rooms.map((r) => ({ slug: r.slug, name: r.name, category: r.category })),
      bookings,
    };
  }),

  /**
   * The event's days, and which one a calendar should open on.
   *
   * Opening on "today" is right during the event and useless before it: in
   * August it lands the desk on an empty day months away from anything, and the
   * only way to see the state of the bookings is to click forward eighty times.
   */
  deskEventDays: authedProcedure.query(async ({ ctx }) => {
    await requireDesk(ctx);
    const { getNe26RoomSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
    );
    const { buildEventSchedule } = await import("@calcom/features/ne26-rooms/lib/eventSchedule");
    const { eventToday } = await import("@calcom/features/ne26-rooms/lib/deskDay");
    const settings = await getNe26RoomSettingsRepository().get();
    const dates = buildEventSchedule(settings.eventDays).map((d) => d.date);
    const today = eventToday();
    return { dates, defaultDate: dates.includes(today) ? today : (dates[0] ?? today) };
  }),

  deskSearch: authedProcedure.input(ZDeskSearchInputSchema).query(async ({ ctx, input }) => {
    await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    return getResourceBookingRepository().searchForDesk(input.query);
  }),

  deskCheckIn: authedProcedure.input(ZDeskCheckInInputSchema).mutation(async ({ ctx, input }) => {
    const { repo, principal, role, actorEmail } = await requireDesk(ctx);
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
      actorEmail,
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
   * Runs through the same startOrderCheckout() path an exhibitor uses on their own
   * phone, so the billing gate, the VAT lines and the hold-release-on-failure
   * behave identically. The hostess never handles a card: this returns the
   * Stripe Checkout URL for the exhibitor to complete.
   */
  deskCreateBooking: authedProcedure
    .input(ZDeskCreateBookingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { repo, principal, role, actorEmail } = await requireDesk(ctx);

      // If they happen to already have an account, bill it — their saved profile
      // and past bookings then line up with this one. Otherwise sell to them
      // anyway: an exhibitor at the counter should not be told to go and sign up.
      const existing = await repo.findUserByEmail(input.exhibitorEmail);

      const { startOrderCheckout } = await import(
        "@calcom/features/ne26-rooms/services/startOrderCheckout"
      );
      const { WEBAPP_URL } = await import("@calcom/lib/constants");
      const booking = await startOrderCheckout({
        buyer: existing
          ? { userId: existing.id, email: existing.email, name: existing.name }
          : { userId: null, email: input.exhibitorEmail, name: input.exhibitorName },
        rooms: [
          {
            slug: input.slug,
            startUtc: new Date(input.startUtc),
            durationHours: input.durationHours,
            addOns: input.addOns,
          },
        ],
        billing: {
          country: input.country,
          vatNumber: input.vatNumber ?? null,
          poNumber: input.poNumber ?? null,
          internalReference: input.internalReference ?? null,
        },
        webappUrl: WEBAPP_URL,
        cancelPath: "/rooms/desk/new",
        // Back to the counter, not the public confirmation page: the hostess is
        // mid-shift and the next exhibitor is already waiting.
        successPath: "/rooms/desk?paid=1",
      });

      await repo.recordAction({
        actorUserId: principal.userId,
        actorEmail,
        actorRole: role,
        action: "booking.create",
        targetType: "booking",
        targetId: booking.uid,
        detail: `Started a booking for ${input.exhibitorName} <${input.exhibitorEmail}> — awaiting payment`,
      });
      return booking;
    }),

  /** Whether a desk PIN exists — never the PIN itself, nor its hash. */
  deskPinStatus: ne26AdminProcedure.query(async () => {
    const { getNe26RoomSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
    );
    const state = await getNe26RoomSettingsRepository().getDeskPinState();
    return { isSet: Boolean(state.hash) };
  }),

  setDeskPin: ne26AdminProcedure
    .input(z.object({ pin: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { hashPin, isValidPin } = await import("@calcom/features/ne26-rooms/lib/deskSession");
      if (!isValidPin(input.pin)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The PIN must be exactly four digits." });
      }
      const { getNe26RoomSettingsRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
      );
      const { getNe26StaffRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
      );
      await getNe26RoomSettingsRepository().setDeskPinHash(hashPin(input.pin));
      await getNe26StaffRepository().recordAction({
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        actorRole: "ADMIN",
        action: "desk.pin.set",
        detail: "Desk PIN changed",
      });
      return { ok: true };
    }),

  // Admin-only: who holds a role, and the trail of what staff have done.
  staff: ne26AdminProcedure.query(async () => {
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const repo = getNe26StaffRepository();
    const [members, actions] = await Promise.all([repo.listStaff(), repo.listRecentActions()]);
    return { members, actions };
  }),

  grantRole: ne26AdminProcedure.input(ZGrantRoleInputSchema).mutation(async ({ ctx, input }) => {
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

  revokeRole: ne26AdminProcedure.input(ZRevokeRoleInputSchema).mutation(async ({ ctx, input }) => {
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
  updateInvoiceSettings: ne26AdminProcedure
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
  issueCreditNote: ne26AdminProcedure.input(ZIssueCreditNoteInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const issued = await getInvoiceService().issueCreditNote(input.uid);
    return { issued };
  }),

  // Admin-only: confirm a PENDING ORDER paid outside Stripe (e.g. bank
  // transfer), then issue its invoice (best-effort).
  //
  // The uid is the order's, not a room's: one payment can cover several rooms,
  // and confirming half of what was settled would leave the rest to expire.
  // Passing null for the payment id is what marks it settled off-Stripe — the
  // invoice then prints no card reference.
  confirmBookingManually: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const confirmed = await getNe26OrderRepository().confirmPaid(input.uid, null);
    if (confirmed) {
      const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
      await getInvoiceService().issueInvoice(input.uid);
    }
    return { confirmed };
  }),

  // Admin-only: cancel a PENDING order without a credit note (test/no-show) and
  // free every room it holds. Paid orders must use the credit-note flow.
  cancelPendingBooking: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const cancelled = await getNe26OrderRepository().cancelPending(input.uid);
    return { cancelled };
  }),

  // Admin-only: issue the invoice for a CONFIRMED booking that never got one —
  // the PDF render or the disk write failed at payment time and the webhook only
  // logged it. Without this the booking is a dead end: it can't be invoiced,
  // can't be credited (that needs an invoice number) and can't be cancelled
  // (that path is PENDING-only), so its room stays held until someone edits the
  // database by hand. issueInvoice is idempotent, so this is safe to retry.
  issueInvoice: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    await getInvoiceService().issueInvoice(input.uid);
    const order = await getNe26OrderRepository().findByUid(input.uid);
    return { issued: Boolean(order?.invoiceNumber) };
  }),

  // Admin-only: re-send an already-issued invoice email to the booker.
  resendInvoice: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const sent = await getInvoiceService().resendInvoice(input.uid);
    return { sent };
  }),

  // Admin-only: list every room (active + inactive) for management.
  listResources: ne26AdminProcedure.query(async () => {
    const { getResourceRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceRepository.container"
    );
    return getResourceRepository().findAllForAdmin();
  }),

  // Admin-only: update booking settings (turnover buffer between bookings).
  updateRoomSettings: ne26AdminProcedure
    .input(ZUpdateRoomSettingsInputSchema)
    .mutation(async ({ input }) => {
      const { getNe26RoomSettingsRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
      );
      return getNe26RoomSettingsRepository().update(input);
    }),

  // Admin-only: update a room's prices / capacity / surface / active state.
  updateResource: ne26AdminProcedure.input(ZUpdateResourceInputSchema).mutation(async ({ input }) => {
    const { getResourceRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceRepository.container"
    );
    const { id, ...data } = input;
    return getResourceRepository().update(id, data);
  }),

  // Admin-only: list every add-on (active + inactive) for management.
  listAddOns: ne26AdminProcedure.query(async () => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    return getAddOnRepository().findAllForAdmin();
  }),

  // Admin-only: update an add-on's name / price / VAT rate / type / active state.
  updateAddOn: ne26AdminProcedure.input(ZUpdateAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    const { id, ...data } = input;
    return getAddOnRepository().update(id, data);
  }),

  // Admin-only: create a new add-on (slug derived from the name).
  createAddOn: ne26AdminProcedure.input(ZCreateAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    const slugify = (await import("@calcom/lib/slugify")).default;
    return getAddOnRepository().create({ ...input, slug: slugify(input.name) });
  }),

  // Admin-only: delete an add-on (refused if used by bookings — deactivate instead).
  deleteAddOn: ne26AdminProcedure.input(ZDeleteAddOnInputSchema).mutation(async ({ input }) => {
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    await getAddOnRepository().delete(input.id);
    return { deleted: true };
  }),

  // Admin-only: list all legal / informational pages (published + drafts).
  listLegalPages: ne26AdminProcedure.query(async () => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    return getNe26LegalPageRepository().findAllForAdmin();
  }),

  // Admin-only: create a legal page.
  createLegalPage: ne26AdminProcedure.input(ZCreateLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    return getNe26LegalPageRepository().create(input);
  }),

  // Admin-only: update a legal page's slug / title / content / published state.
  updateLegalPage: ne26AdminProcedure.input(ZUpdateLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    const { id, ...data } = input;
    return getNe26LegalPageRepository().update(id, data);
  }),

  // Admin-only: delete a legal page.
  deleteLegalPage: ne26AdminProcedure.input(ZDeleteLegalPageInputSchema).mutation(async ({ input }) => {
    const { getNe26LegalPageRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container"
    );
    await getNe26LegalPageRepository().delete(input.id);
    return { deleted: true };
  }),

  // Admin-only: current room blocks (maintenance / internal use).
  listBlocks: ne26AdminProcedure.query(async () => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    return getResourceBookingService().listBlocks();
  }),

  // Admin-only: block a room on a slot (rejected if it overlaps a booking).
  createBlock: ne26AdminProcedure.input(ZCreateBlockInputSchema).mutation(async ({ input }) => {
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
  removeBlock: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
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
    // One room is an order of one. There is no separate single-room path: two
    // implementations of a checkout is two places for the money to diverge.
    const { startOrderCheckout } = await import(
      "@calcom/features/ne26-rooms/services/startOrderCheckout"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return startOrderCheckout({
      buyer: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
      rooms: [
        {
          slug: input.slug,
          startUtc: new Date(input.startUtc),
          durationHours: input.durationHours,
          addOns: input.addOns,
        },
      ],
      webappUrl: WEBAPP_URL,
      cancelPath: `/rooms/${input.slug}`,
    });
  }),

  /**
   * The event days this exhibitor already has a room on — confirmed or still
   * held. One room per exhibitor per day is a commercial rule enforced in the
   * order service; this lets the shortlist and the room page say so BEFORE the
   * buyer commits, instead of the rule surfacing as a refusal at payment.
   */
  myBookedDays: authedProcedure.query(async ({ ctx }): Promise<{ days: string[] }> => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const { eventDateOf } = await import("@calcom/features/ne26-rooms/lib/deskDay");
    const starts = await getNe26OrderRepository().findBookedStartsForUser(ctx.user.id, new Date());
    return { days: Array.from(new Set(starts.map(eventDateOf))).sort() };
  }),

  /** The shortlist, paid in one go: several rooms, one payment, one invoice. */
  createOrder: authedProcedure.input(ZCreateOrderInputSchema).mutation(async ({ ctx, input }) => {
    const { startOrderCheckout } = await import(
      "@calcom/features/ne26-rooms/services/startOrderCheckout"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return startOrderCheckout({
      buyer: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
      rooms: input.rooms.map((r) => ({
        slug: r.slug,
        startUtc: new Date(r.startUtc),
        durationHours: r.durationHours,
        addOns: r.addOns,
      })),
      webappUrl: WEBAPP_URL,
      cancelPath: "/rooms",
    });
  }),

  // Resume an abandoned PENDING booking: rebuild its checkout and return the URL.
  /** Rebuild the payment page for an order held but never paid. */
  resumeOrder: authedProcedure.input(ZBookingUidInputSchema).mutation(async ({ ctx, input }) => {
    const { resumeOrderCheckout } = await import(
      "@calcom/features/ne26-rooms/services/startOrderCheckout"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return resumeOrderCheckout({
      orderUid: input.uid,
      buyerUserId: ctx.user.id,
      buyerEmail: ctx.user.email,
      webappUrl: WEBAPP_URL,
    });
  }),
});
