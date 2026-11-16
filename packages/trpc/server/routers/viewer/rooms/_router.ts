import { TRPCError } from "@trpc/server";
import { z } from "zod";
import authedProcedure, { authedAdminProcedure } from "../../../procedures/authedProcedure";
import { router } from "../../../trpc";
import { ZBookingUidInputSchema } from "./bookingUid.schema";
import { ZChangeBookerEmailInputSchema, ZChangeMyEmailInputSchema } from "./accountEmail.schema";
import { ZCorrectBillingInputSchema } from "./correctBilling.schema";
import { ZCreateBlockInputSchema } from "./createBlock.schema";
import { ZExtendBookingInputSchema } from "./extendBooking.schema";
import { ZMoveBookingInputSchema } from "./moveBooking.schema";
import { ZCreateBookingInputSchema, ZCreateOrderInputSchema } from "./createBooking.schema";
import {
  ZDeskCancellationRequestInputSchema,
  ZDeskCheckInInputSchema,
  ZDeskCreateBookingInputSchema,
  ZDeskDayInputSchema,
  ZDeskQuoteInputSchema,
  ZDeskResumePaymentInputSchema,
  ZDeskSearchInputSchema,
} from "./desk.schema";
import { ZIssueCreditNoteInputSchema } from "./issueCreditNote.schema";
import {
  ZCreateLegalPageInputSchema,
  ZDeleteLegalPageInputSchema,
  ZUpdateLegalPageInputSchema,
} from "./legalPage.schema";
import { ZPreviewOrderVatInputSchema, ZPreviewVatInputSchema } from "./previewVat.schema";
import { ZBookerAccountInputSchema, ZGrantRoleInputSchema, ZRevokeRoleInputSchema } from "./staff.schema";
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
  const { deskBlocksAdmin, deskStateFromCookieHeader } = await import(
    "@calcom/features/ne26-rooms/lib/deskSession"
  );
  const header = (ctx as { req?: { headers?: Record<string, unknown> } }).req?.headers?.cookie;
  const desk = deskStateFromCookieHeader(typeof header === "string" ? header : null);
  // Including a shift that has ended: the lock outlives the shift, and the PIN
  // is still the only thing that clears it.
  if (deskBlocksAdmin(desk)) {
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
  const { deskStateFromCookieHeader } = await import("@calcom/features/ne26-rooms/lib/deskSession");
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
  const desk = deskStateFromCookieHeader(typeof header === "string" ? header : null);
  // A shift that has ended cannot keep working under the name of someone who
  // has gone home — the desk stops too, not only the admin.
  if (desk.kind === "expired") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This desk shift has ended. Enter the PIN to unlock the tablet and start a new one.",
    });
  }
  const actorEmail = desk.kind === "active" ? desk.session.hostessName : principal.email;
  const role = desk.kind === "active" ? "HOSTESS" : roleOf(principal);

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
      startUtc: input.startUtc,
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
    const { getAddOnRepository } = await import("@calcom/features/ne26-rooms/di/AddOnRepository.container");
    const { getNe26RoomSettingsRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
    );
    const [availability, catalogue, settings] = await Promise.all([
      getRoomAvailabilityService().getAvailabilityForAllRooms(),
      getAddOnRepository().findManyActive(),
      getNe26RoomSettingsRepository().get(),
    ]);
    // The counter sells rooms for as long as there are rooms, and catering only
    // while the kitchen will take it. Two different deadlines, one switch.
    return { rooms: availability, addOns: settings.cateringSalesOpen ? catalogue : [] };
  }),

  /**
   * The planning board: every room across one day, with what occupies it.
   *
   * Returns the day's own opening window so the client draws exactly the hours
   * the schedule opens, rather than assuming a window and disagreeing with
   * availability at the edges. Bookings are placed inside it to the minute.
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
    const { buildEventSchedule, SLOT_GRANULARITY_MS } = await import(
      "@calcom/features/ne26-rooms/lib/eventSchedule"
    );

    const { fromUtc, toUtc } = eventDayBounds(input.date);
    const now = new Date();
    const [rooms, settings, bookings] = await Promise.all([
      getResourceRepository().findManyActive(),
      getNe26RoomSettingsRepository().get(),
      getResourceBookingRepository().findForPlanning(fromUtc, toUtc, now),
    ]);

    const day = buildEventSchedule(settings.eventDays).find((d) => d.date === input.date);
    const marks = day?.openSlotStartsUtc ?? [];
    const first = marks[0];
    const last = marks[marks.length - 1];
    return {
      date: input.date,
      bufferMinutes: settings.bufferMinutes,
      nowUtc: now.toISOString(),
      // The day's window, so the board can place a booking to the minute
      // instead of snapping it to a column.
      openUtc: first ? first.toISOString() : null,
      closeUtc: last ? new Date(last.getTime() + SLOT_GRANULARITY_MS).toISOString() : null,
      rooms: rooms.map((r) => ({
        slug: r.slug,
        name: r.name,
        venueName: r.venueName,
        category: r.category,
        capacity: r.capacity,
      })),
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
      // The hostess, not the shared tablet's account — the same actor the audit
      // trail records, so the two cannot tell different stories about who was
      // standing there.
      input.arrived ? actorEmail : null
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
   * What this sale comes to, before anybody is asked for a card.
   *
   * The counter screen carried no figure at all, so a hostess could take an
   * exhibitor through five steps and still not be able to answer "how much?" —
   * the first time either of them saw a total was on the Stripe page. The
   * country typed into the form is part of the question, since it decides the
   * VAT, which is why the quote is asked for here rather than assembled from
   * the catalogue on the tablet.
   */
  deskQuote: authedProcedure.input(ZDeskQuoteInputSchema).query(async ({ ctx, input }) => {
    await requireDesk(ctx);
    const { getRoomVatPreviewService } = await import(
      "@calcom/features/ne26-rooms/di/RoomVatPreviewService.container"
    );
    return getRoomVatPreviewService().preview({
      billing: { country: input.country ?? null, vatNumber: input.vatNumber ?? null },
      slug: input.slug,
      durationHours: input.durationHours,
      startUtc: input.startUtc,
      addOns: input.addOns,
    });
  }),

  /**
   * Take an exhibitor's request to cancel a room — and only take it.
   *
   * The desk cannot cancel, refund or free a slot, and this does not give it
   * any of those: it writes who asked, who took it and what they said, then
   * tells sales. Everything that costs money stays in the admin, where it is
   * decided by somebody who can see the amount.
   *
   * It exists because the alternative at the counter was "write to sales",
   * which leaves no trace, no owner and no clock — and because from the moment
   * self-service cancellation closes, the desk is the only door left.
   */
  deskRequestCancellation: authedProcedure
    .input(ZDeskCancellationRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { repo, principal, role, actorEmail } = await requireDesk(ctx);
      const { getResourceBookingRepository } = await import(
        "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
      );
      const { canRequestCancellation, cancellationRequestNotification, requestRefusalMessage } = await import(
        "@calcom/features/ne26-rooms/lib/cancellationRequest"
      );
      const bookings = getResourceBookingRepository();
      const booking = await bookings.findForCancellationRequest(input.uid);
      if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "No such booking." });

      const verdict = canRequestCancellation(booking);
      if (!verdict.allowed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: requestRefusalMessage(verdict.reason) });
      }

      const note = input.note?.trim() ? input.note.trim() : null;
      const taken = await bookings.requestCancellation(input.uid, actorEmail, note);
      if (!taken) {
        // Lost a race with another tablet, or with the exhibitor cancelling it
        // themselves a moment ago. One ask, one mail.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: requestRefusalMessage("already-requested"),
        });
      }

      await repo.recordAction({
        actorUserId: principal.userId,
        actorEmail,
        actorRole: role,
        action: "booking.cancellation.requested",
        targetType: "booking",
        targetId: input.uid,
        detail: note ? `Cancellation asked at the desk: ${note}` : "Cancellation asked at the desk",
      });

      const { roomFullLabel } = await import("@calcom/features/ne26-rooms/lib/roomNames");
      const { formatSlotRange } = await import("@calcom/features/ne26-rooms/lib/teamNotification");
      const { orderRef } = await import("@calcom/features/ne26-rooms/lib/orderRef");
      const { notifyTeam } = await import("@calcom/features/ne26-rooms/lib/notifyTeam");
      const { WEBAPP_URL } = await import("@calcom/lib/constants");

      const mail = cancellationRequestNotification({
        roomLabel: roomFullLabel(booking.resource),
        slotLabel: formatSlotRange(booking.startTime, booking.endTime),
        bookerName: booking.bookerName,
        bookerEmail: booking.bookerEmail,
        company: booking.order?.bookerLegalName ?? null,
        takenBy: actorEmail,
        note,
        orderUrl: booking.order ? `${WEBAPP_URL}/rooms/admin/order/${booking.order.uid}` : WEBAPP_URL,
        orderRef: booking.order ? orderRef(booking.order.orderNumber) : "—",
      });
      // Never throws: the ask is recorded either way, and a mail that failed
      // must not tell the hostess the request was refused.
      await notifyTeam("sales", mail.subject, mail.body, mail.html);

      return { taken: true };
    }),

  /**
   * The payment page for a hold, again.
   *
   * A sale started at the counter lived on one screen: once it was left, the
   * link was gone and the room stayed held by a payment nobody could reach any
   * more. The desk is staff, so it may reopen anybody's hold — unlike the
   * exhibitor's own resume, which is scoped to their account.
   */
  deskResumePayment: authedProcedure.input(ZDeskResumePaymentInputSchema).mutation(async ({ ctx, input }) => {
    const { repo, principal, role, actorEmail } = await requireDesk(ctx);
    const { getResourceBookingRepository } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container"
    );
    const booking = await getResourceBookingRepository().findForCancellationRequest(input.uid);
    if (!booking?.order) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That booking has no payment to reopen." });
    }

    const { resumeOrderCheckout } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    let checkoutUrl: string;
    try {
      const resumed = await resumeOrderCheckout({
        orderUid: booking.order.uid,
        buyerEmail: booking.bookerEmail,
        webappUrl: WEBAPP_URL,
        // Staff: the desk reopens the hold of whoever is standing there, which
        // is not necessarily an account at all.
        asStaff: true,
      });
      checkoutUrl = resumed.checkoutUrl;
    } catch (e) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: e instanceof Error ? e.message : "That hold can no longer be paid for.",
      });
    }

    if (input.email) {
      const { sendPaymentLinkEmail } = await import("@calcom/features/ne26-rooms/lib/paymentLinkEmail");
      await sendPaymentLinkEmail({
        to: booking.bookerEmail,
        bookerName: booking.bookerName,
        roomLabel: booking.resource.name,
        checkoutUrl,
      });
    }

    await repo.recordAction({
      actorUserId: principal.userId,
      actorEmail,
      actorRole: role,
      action: input.email ? "booking.payment.link.emailed" : "booking.payment.reopened",
      targetType: "booking",
      targetId: input.uid,
      detail: input.email ? `Payment link sent to ${booking.bookerEmail}` : "Payment page reopened",
    });

    return { checkoutUrl, emailed: Boolean(input.email) };
  }),

  /**
   * Sell a room to someone standing at the counter.
   *
   * Runs through the same startOrderCheckout() path an exhibitor uses on their own
   * phone, so the billing gate, the VAT lines and the hold-release-on-failure
   * behave identically. The hostess never handles a card: this returns the
   * Stripe Checkout URL for the exhibitor to complete.
   */
  deskCreateBooking: authedProcedure.input(ZDeskCreateBookingInputSchema).mutation(async ({ ctx, input }) => {
    const { repo, principal, role, actorEmail } = await requireDesk(ctx);

    // If they happen to already have an account, bill it — their saved profile
    // and past bookings then line up with this one. Otherwise sell to them
    // anyway: an exhibitor at the counter should not be told to go and sign up.
    const existing = await repo.findUserByEmail(input.exhibitorEmail);

    const { startOrderCheckout } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
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

  setDeskPin: ne26AdminProcedure.input(z.object({ pin: z.string() })).mutation(async ({ ctx, input }) => {
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

  // Admin-only: mark a PENDING order paid without a Stripe payment, then issue
  // its invoice (best-effort). Sales go through Stripe by card; this is the
  // manual escape hatch for the case where the money is known to have arrived
  // but the confirmation never ran — it charges nothing itself.
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

  // Admin-only: close an order that holds no rooms, once it has been settled in
  // Stripe. The rooms are gone and may belong to someone else, so there is
  // nothing here to re-book and nothing to invoice — this only records that a
  // human dealt with it, so the alert stops. The row keeps its payment id and
  // amount: that is the reconciliation trail.
  closeSettledOrder: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const closed = await getNe26OrderRepository().closeSettledOrder(input.uid);
    return { closed };
  }),

  // Admin-only: every exhibitor account, including the ones that never booked —
  // which the Bookers list cannot show, because it is built from bookings.
  listBookerAccounts: ne26AdminProcedure.query(async () => {
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    return getNe26StaffRepository().listBookerAccounts();
  }),

  // Admin-only: remove an exhibitor account and the orders of theirs that never
  // became a document. Orders carrying an invoice or a credit note stay, and
  // stay complete — they froze the buyer's details at the time of sale and hold
  // no foreign key to the account.
  deleteBookerAccount: ne26AdminProcedure
    .input(ZBookerAccountInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Deleting the account you are signed in as would end the session that is
      // doing it, and there is no way back in. The repository refuses staff;
      // only this layer knows who is asking.
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account." });
      }
      const { getNe26StaffRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
      );
      const repo = getNe26StaffRepository();
      const result = await repo.deleteBookerAccount(input.userId);
      if (result.refusedBecause === "staff") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That is a staff account. Remove the role on the Access page first.",
        });
      }
      if (result.deleted) {
        await repo.recordAction({
          actorUserId: ctx.user.id,
          actorEmail: ctx.user.email,
          actorRole: "ADMIN",
          action: "booker.delete",
          targetType: "user",
          targetId: String(input.userId),
          detail: `Deleted ${result.ordersDeleted} order(s); kept ${result.ordersKept} with documents`,
        });
      }
      return result;
    }),

  // Admin-only: delete an order that never became anything — a test booking, a
  // mistake. Cascades to its rooms and their slots, which is what puts them back
  // on sale. Refused once an invoice or credit note exists: those are numbered
  // documents in a gapless series, and they are undone with a credit note.
  deleteOrder: ne26AdminProcedure.input(ZBookingUidInputSchema).mutation(async ({ input }) => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const deleted = await getNe26OrderRepository().deleteUndocumented(input.uid);
    return { deleted };
  }),

  // Admin-only: re-send an already-issued invoice email to the booker.
  // Admin-only: correct who an order is billed to (company, contact, address).
  // Issued documents are re-rendered under the same number and date; nothing
  // else on the order changes. Logged with what it was and what it became.
  correctBilling: ne26AdminProcedure.input(ZCorrectBillingInputSchema).mutation(async ({ ctx, input }) => {
    const { getInvoiceService } = await import("@calcom/features/ne26-rooms/di/InvoiceService.container");
    const { uid, emailBuyer, ...correction } = input;
    const result = await getInvoiceService().correctBilling(uid, correction);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "No such order." });

    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    await getNe26StaffRepository().recordAction({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "ADMIN",
      action: "order.billing.correct",
      targetType: "order",
      targetId: uid,
      detail: result.changes || "Saved with no change",
    });

    let emailed = false;
    if (emailBuyer && result.regenerated.includes("invoice")) {
      emailed = await getInvoiceService().resendInvoice(uid);
    }
    return { regenerated: result.regenerated, changed: Boolean(result.changes), emailed };
  }),

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
  updateRoomSettings: ne26AdminProcedure.input(ZUpdateRoomSettingsInputSchema).mutation(async ({ input }) => {
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
  /**
   * Sell an exhibitor more time on a room they already have, back to back.
   *
   * Admin-only and on their request. It creates a SECOND booking priced at the
   * ordinary package rate for its own length — room prices are per duration and
   * not proportional, so there is no price for "a fourth hour" — and emails the
   * payment link, because nobody is at a screen when this is agreed. The
   * invoice follows from the payment exactly as it does for any other sale.
   *
   * Deliberately outside the rooms-per-day cap: this is not another room, it is
   * more time on one already paid for, and refusing it would force an admin to
   * raise the cap for everybody to grant one exhibitor an extra hour.
   */
  extendBooking: ne26AdminProcedure.input(ZExtendBookingInputSchema).mutation(async ({ ctx, input }) => {
    const { createBookingExtension } = await import(
      "@calcom/features/ne26-rooms/services/BookingExtensionService"
    );
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    const extension = await createBookingExtension({
      parentBookingUid: input.uid,
      direction: input.direction,
      durationHours: input.durationHours,
      webappUrl: WEBAPP_URL,
    });

    const { formatMoney } = await import("@calcom/features/ne26-rooms/lib/teamNotification");
    const { sendExtensionPaymentEmail } = await import("@calcom/features/ne26-rooms/lib/mailer");
    // The booking exists and the room is held whatever happens to the mail. A
    // failed send is reported so the desk can read the link off the booking
    // page and pass it on, rather than silently leaving an exhibitor waiting
    // for a message that never comes.
    let emailed = true;
    try {
      await sendExtensionPaymentEmail({
        to: extension.bookerEmail,
        bookerName: extension.bookerName,
        roomName: extension.roomName,
        slotLabel: extension.slotLabel,
        parentSlotLabel: extension.parentSlotLabel,
        amountLabel: formatMoney(extension.amountTotal, extension.currency),
        payUrl: extension.checkoutUrl,
      });
    } catch (error) {
      // Logged, not swallowed: without this the only sign of a misconfigured
      // SMTP relay is a line in the admin saying the mail did not go, with
      // nothing anywhere saying why.
      console.error("[ne26] extension payment email failed", error);
      emailed = false;
    }

    await getNe26StaffRepository().recordAction({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "ADMIN",
      action: "booking.extend",
      targetType: "booking",
      targetId: input.uid,
      detail: `${input.direction === "before" ? "Earlier start" : "Later finish"}: ${
        input.durationHours
      }h in ${extension.roomName}, ${extension.slotLabel} — ${formatMoney(
        extension.amountTotal,
        extension.currency
      )}, awaiting payment`,
    });

    return { ...extension, emailed };
  }),

  /**
   * Shift an existing booking to a different time, same room, same length.
   *
   * Admin-only, at the exhibitor's request. No money moves: the price is
   * unchanged, so there is no credit note and no second invoice — the issued
   * one is redrawn under its own number because only the line describing the
   * slot was wrong.
   */
  moveBooking: ne26AdminProcedure.input(ZMoveBookingInputSchema).mutation(async ({ ctx, input }) => {
    const { moveBooking } = await import("@calcom/features/ne26-rooms/services/MoveBookingService");
    const { getNe26StaffRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26StaffRepository.container"
    );
    const { WEBAPP_URL } = await import("@calcom/lib/constants");

    const moved = await moveBooking({
      bookingUid: input.uid,
      newStartUtc: new Date(input.newStartUtc),
    });

    // The move has happened by here. A failed mail is reported, never thrown:
    // undoing a booking the exhibitor has already been told about by phone
    // would be worse than an email that did not arrive.
    let emailed = false;
    if (input.notify) {
      const { sendBookingMovedEmail } = await import("@calcom/features/ne26-rooms/lib/mailer");
      try {
        await sendBookingMovedEmail({
          to: moved.bookerEmail,
          bookerName: moved.bookerName,
          roomName: moved.roomName,
          fromLabel: moved.fromLabel,
          toLabel: moved.toLabel,
          bookingsUrl: `${WEBAPP_URL}/rooms/bookings`,
        });
        emailed = true;
      } catch (error) {
        console.error("[ne26] booking moved email failed", error);
      }
    }

    await getNe26StaffRepository().recordAction({
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email,
      actorRole: "ADMIN",
      action: "booking.move",
      targetType: "booking",
      targetId: input.uid,
      detail: `${moved.roomName}: ${moved.fromLabel} → ${moved.toLabel}${
        moved.invoiceRedrawn ? " · invoice redrawn" : ""
      }${input.notify ? (emailed ? " · exhibitor told" : " · email FAILED") : " · exhibitor not told"}`,
    });

    return { ...moved, emailed };
  }),

  createBlock: ne26AdminProcedure.input(ZCreateBlockInputSchema).mutation(async ({ input }) => {
    const { getResourceBookingService } = await import(
      "@calcom/features/ne26-rooms/di/ResourceBookingService.container"
    );
    await getResourceBookingService().createBlock({
      slug: input.slug,
      startUtc: new Date(input.startUtc),
      durationHours: input.durationHours,
      note: input.note ?? null,
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
    const { startOrderCheckout } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
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
   * The event days this exhibitor can no longer book — they already hold as
   * many rooms there as the cap allows — plus the days carrying one of their own
   * unpaid holds.
   *
   * The cap is a commercial rule enforced in the order service and settable by
   * an admin. This lets the shortlist and the room page say so BEFORE the buyer
   * commits, instead of the rule surfacing as a refusal at payment.
   */
  myBookedDays: authedProcedure.query(
    async ({
      ctx,
    }): Promise<{
      days: string[];
      heldDays: string[];
      paidSlots: { slug: string; startUtc: string }[];
      maxRoomsPerDay: number;
    }> => {
      const { getNe26OrderRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
      );
      const { getNe26RoomSettingsRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26RoomSettingsRepository.container"
      );
      const { eventDateOf } = await import("@calcom/features/ne26-rooms/lib/deskDay");
      const [occupied, settings] = await Promise.all([
        getNe26OrderRepository().findOccupiedDaysForUser(
          { userId: ctx.user.id, email: ctx.user.email },
          new Date()
        ),
        getNe26RoomSettingsRepository().get(),
      ]);
      const cap = settings.maxRoomsPerDayPerExhibitor;
      // `days` blocks, `heldDays` only informs. A day carrying the exhibitor's
      // own unpaid hold is not spent: paying for the basket replaces that hold.
      // Reporting both as "booked" greyed out the day they were shopping for.
      //
      // A day blocks once their PAID rooms there reach the cap, counted room by
      // room. Below the cap the day stays open, which is the whole point of the
      // setting: at a cap of 1 this is exactly the old "has a room that day".
      const paidPerDay: Record<string, number> = {};
      const heldDays = new Set<string>();
      for (const row of occupied) {
        const day = eventDateOf(row.startTime);
        if (row.paid) paidPerDay[day] = (paidPerDay[day] ?? 0) + 1;
        else heldDays.add(day);
      }
      const days = new Set(Object.keys(paidPerDay).filter((day) => (paidPerDay[day] ?? 0) >= cap));
      return {
        maxRoomsPerDay: cap,
        days: Array.from(days).sort(),
        heldDays: Array.from(heldDays)
          .filter((d) => !days.has(d))
          .sort(),
        // The rooms actually bought, so the shortlist can drop a line for a room
        // that has since been paid for rather than warn about it forever.
        paidSlots: occupied
          .filter((row) => row.paid)
          .map((row) => ({ slug: row.roomSlug, startUtc: row.startTime.toISOString() })),
      };
    }
  ),

  /**
   * The order this exhibitor is holding but has not paid, if any.
   *
   * Feeds the countdown in the shortlist panel. It lived on "My bookings",
   * which is where people go AFTER paying — so the one clock that matters was
   * on the page nobody visits while it is running.
   */
  myPendingOrder: authedProcedure.query(
    async ({
      ctx,
    }): Promise<{
      uid: string;
      holdExpiresAt: string;
      amountTotal: number;
      currency: string;
      rooms: number;
    } | null> => {
      const { getNe26OrderRepository } = await import(
        "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
      );
      const order = await getNe26OrderRepository().findLiveHoldForUser(ctx.user.id, new Date());
      if (!order?.holdExpiresAt) return null;
      return {
        uid: order.uid,
        holdExpiresAt: order.holdExpiresAt.toISOString(),
        amountTotal: order.amountTotal,
        currency: order.currency,
        rooms: order._count.bookings,
      };
    }
  ),

  /** The whole shortlist priced together, so one VAT total covers the basket. */
  previewOrderVat: authedProcedure.input(ZPreviewOrderVatInputSchema).query(async ({ ctx, input }) => {
    const { getRoomVatPreviewService } = await import(
      "@calcom/features/ne26-rooms/di/RoomVatPreviewService.container"
    );
    return getRoomVatPreviewService().previewOrder({ userId: ctx.user.id, rooms: input.rooms });
  }),

  /**
   * Take the shortlisted rooms off sale for the hold window, without paying.
   *
   * The deliberate step between browsing and paying: the exhibitor decides to
   * reserve, a clock starts in the shortlist, and the rooms come back if the
   * payment never lands.
   */
  holdRooms: authedProcedure.input(ZCreateOrderInputSchema).mutation(async ({ ctx, input }) => {
    const { holdRooms } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return holdRooms({
      buyer: { userId: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
      rooms: input.rooms.map((r) => ({
        slug: r.slug,
        startUtc: new Date(r.startUtc),
        durationHours: r.durationHours,
        addOns: r.addOns,
      })),
      webappUrl: WEBAPP_URL,
    });
  }),

  /** The shortlist, paid in one go: several rooms, one payment, one invoice. */
  createOrder: authedProcedure.input(ZCreateOrderInputSchema).mutation(async ({ ctx, input }) => {
    const { startOrderCheckout } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
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

  /*
   * There is no procedure here for an exhibitor cancelling a room.
   *
   * There was one, and it refunded the card in full by itself. Article 4 of the
   * terms says the opposite — an order is binding on payment and Extra Services
   * are not refundable, with the exceptions (postponement, cancellation by the
   * organiser, force majeure) being the organiser's to declare, not a button's.
   * Removed rather than guarded: a procedure that spends money is a liability
   * even when every caller is supposed to be unreachable.
   *
   * A room now comes back only through the admin, which refunds in Stripe by
   * hand and raises the credit note against it. The welcome desk cannot do it
   * either — it records that an exhibitor asked, and tells sales.
   */

  /**
   * The exhibitor changes the address they sign in with.
   *
   * The password is the point: this address is the login, so a session left open
   * must not be enough to take the account. Everything they bought carries a
   * copy of the old address and moves with it — see AccountEmailService.
   */
  changeMyEmail: authedProcedure.input(ZChangeMyEmailInputSchema).mutation(async ({ ctx, input }) => {
    const { getAccountEmailService } = await import(
      "@calcom/features/ne26-rooms/di/AccountEmailService.container"
    );
    const { EmailChangeRefused } = await import("@calcom/features/ne26-rooms/services/AccountEmailService");
    try {
      return await getAccountEmailService().changeOwnEmail(ctx.user.id, input.email, input.password);
    } catch (e) {
      if (e instanceof EmailChangeRefused) {
        throw new TRPCError({
          code: e.reason === "wrong-password" ? "UNAUTHORIZED" : "BAD_REQUEST",
          message: e.message,
        });
      }
      throw e;
    }
  }),

  // Admin-only: correct an exhibitor's address for them. Logged with both
  // addresses, because it changes who can sign into that account.
  changeBookerEmail: ne26AdminProcedure
    .input(ZChangeBookerEmailInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { getAccountEmailService } = await import(
        "@calcom/features/ne26-rooms/di/AccountEmailService.container"
      );
      const { EmailChangeRefused } = await import("@calcom/features/ne26-rooms/services/AccountEmailService");
      try {
        return await getAccountEmailService().changeEmailAsAdmin(input.userId, input.email, {
          id: ctx.user.id,
          email: ctx.user.email,
        });
      } catch (e) {
        if (e instanceof EmailChangeRefused) {
          throw new TRPCError({
            code: e.reason === "not-found" ? "NOT_FOUND" : "BAD_REQUEST",
            message: e.message,
          });
        }
        throw e;
      }
    }),

  releaseMyHold: authedProcedure.input(ZBookingUidInputSchema).mutation(async ({ ctx, input }) => {
    const { getNe26OrderRepository } = await import(
      "@calcom/features/ne26-rooms/di/Ne26OrderRepository.container"
    );
    const orders = getNe26OrderRepository();
    // Read before the delete: the payment page opened for this hold has to be
    // closed too, or it can still be paid for rooms nobody holds any more.
    const sessions = await orders.findStripeSessionIds([input.uid]);
    const released = await orders.releaseOwnHold(input.uid, ctx.user.id);
    if (!released) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That hold is no longer yours to release." });
    }
    if (sessions.length > 0) {
      const { getStripeCheckoutService } = await import(
        "@calcom/features/ne26-rooms/di/StripeCheckoutService.container"
      );
      const stripe = getStripeCheckoutService();
      for (const sessionId of sessions) {
        await stripe.expireSession(sessionId).catch(() => {
          // Already paid or already expired — nothing left to close.
        });
      }
    }
    return { released: true };
  }),

  resumeOrder: authedProcedure.input(ZBookingUidInputSchema).mutation(async ({ ctx, input }) => {
    const { resumeOrderCheckout } = await import("@calcom/features/ne26-rooms/services/startOrderCheckout");
    const { WEBAPP_URL } = await import("@calcom/lib/constants");
    return resumeOrderCheckout({
      orderUid: input.uid,
      buyerUserId: ctx.user.id,
      buyerEmail: ctx.user.email,
      webappUrl: WEBAPP_URL,
    });
  }),
});
