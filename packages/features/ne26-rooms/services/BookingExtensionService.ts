import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { getInvoiceSettingsRepository } from "../di/InvoiceSettingsRepository.container";
import { getNe26BillingProfileRepository } from "../di/Ne26BillingProfileRepository.container";
import { getNe26OrderRepository } from "../di/Ne26OrderRepository.container";
import { getNe26RoomSettingsRepository } from "../di/Ne26RoomSettingsRepository.container";
import { getResourceBookingRepository } from "../di/ResourceBookingRepository.container";
import { getStripeCheckoutService } from "../di/StripeCheckoutService.container";
import { type ExtensionDirection, planExtension } from "../lib/bookingExtension";
import { buildEventSchedule, buildOpenSlotMs, type DurationHours } from "../lib/eventSchedule";
import { buildInvoiceModel, ROOM_VAT_RATE_BP } from "../lib/invoice";
import { formatSlotRange } from "../lib/teamNotification";
import { resolveVatTreatment } from "../lib/vat";
import { checkoutExpiresAtSeconds } from "./StripeCheckoutService";

export interface CreateExtensionInput {
  /** The paid booking being continued. */
  parentBookingUid: string;
  direction: ExtensionDirection;
  durationHours: DurationHours;
  webappUrl: string;
}

export interface CreatedExtension {
  orderUid: string;
  bookingUid: string;
  checkoutUrl: string;
  /** Who the payment link is for, so the caller can say where it went. */
  bookerEmail: string;
  bookerName: string;
  roomName: string;
  /** The continuation's own window. */
  slotLabel: string;
  /** The meeting it continues, so the email can name what was agreed. */
  parentSlotLabel: string;
  amountTotal: number;
  currency: string;
}

/**
 * Sell an exhibitor more time on a room they already have, back to back.
 *
 * Admin-only and on their request: somebody at the desk is being asked to make
 * a meeting start earlier or run later, and nothing here is reachable by an
 * exhibitor on their own.
 *
 * It is a SECOND booking, not an edit of the first, and that is the whole
 * design. Room prices are per duration and deliberately not proportional, so
 * there is no price for "a fourth hour" to compute — the continuation is
 * charged the ordinary package price for its own length, which is the rate the
 * exhibitor was quoted in the first place. It gets its own order, its own
 * payment and its own invoice, exactly like any second booking by the same
 * exhibitor, and every path downstream — the webhook, the invoice, the desk —
 * handles it without knowing it is a continuation.
 *
 * Two things are deliberately different from a normal sale:
 *
 * The rooms-per-day cap does not apply. This is not another room; it is more
 * time on one they have already paid for, and refusing it would force an admin
 * to raise the cap for everybody just to grant one exhibitor an extra hour.
 *
 * There is no 35-minute clock. The hold runs until the booking itself starts,
 * because the payment link is emailed rather than opened in front of us, and a
 * link that outlives what it pays for is how somebody gets charged for a room
 * that went back on sale. If nobody pays by the time it would have begun, it
 * lapses on its own; before that, an admin can cancel it.
 */
export async function createBookingExtension(input: CreateExtensionInput): Promise<CreatedExtension> {
  const bookings = getResourceBookingRepository();
  const orders = getNe26OrderRepository();
  const parent = await bookings.findExtensionParent(input.parentBookingUid);

  if (!parent || parent.isBlock) {
    throw new ErrorWithCode(ErrorCode.NotFound, "That booking no longer exists.");
  }
  if (parent.status !== "CONFIRMED") {
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "That booking has not been paid for yet. Take the payment first — there is nothing to continue until then."
    );
  }

  const settings = await getNe26RoomSettingsRepository().get();
  const openSlotMs = buildOpenSlotMs(buildEventSchedule(settings.eventDays));
  const now = new Date();
  // Deliberately WITHOUT takenSlotMs: whether the hours are free is the unique
  // index's to answer, at the moment of writing. Reading it here would be a
  // guess a concurrent buyer can invalidate between the read and the write.
  const plan = planExtension({
    parent: { uid: parent.uid, startTime: parent.startTime, endTime: parent.endTime },
    direction: input.direction,
    durationHours: input.durationHours,
    bufferMinutes: settings.bufferMinutes,
    openSlotMs,
    now,
  });

  // The ordinary package price for the continuation's own length. Same
  // expression as a normal sale, read from the same columns.
  const amountTotal = { 1: parent.resource.price1h, 2: parent.resource.price2h, 3: parent.resource.price3h }[
    input.durationHours
  ];
  const currency = parent.resource.currency;

  // Held until it would begin, not for 35 minutes: see the note above.
  const order = await orders.createWithRooms({
    bookerUserId: parent.bookerUserId,
    bookerEmail: parent.bookerEmail,
    bookerName: parent.bookerName,
    bookerCountry: parent.bookerCountry,
    bookerVatNumber: parent.bookerVatNumber,
    // Carried over so the second invoice quotes the same purchase order as the
    // first: finance is matching two documents to one commitment.
    bookerPoNumber: parent.order?.bookerPoNumber ?? null,
    bookerInternalReference: parent.order?.bookerInternalReference ?? null,
    amountTotal,
    currency,
    holdExpiresAt: plan.startTime,
    rooms: [
      {
        resourceId: parent.resourceId,
        startTime: plan.startTime,
        endTime: plan.endTime,
        durationMinutes: plan.durationMinutes,
        slotStarts: [...plan.slotStarts, ...plan.bufferSlots],
        extendsBookingUid: parent.uid,
        amountTotal,
        addOns: [],
      },
    ],
  });

  if (!order) {
    throw new ErrorWithCode(ErrorCode.InternalServerError, "The continuation could not be created.");
  }

  // VAT resolved before Stripe is charged, exactly as a normal sale does it:
  // charging one rate and invoicing another is the failure to avoid.
  const issuer = await getInvoiceSettingsRepository().get();
  const vat = resolveVatTreatment(
    { country: parent.bookerCountry, vatNumber: parent.bookerVatNumber },
    issuer
  );
  const model = buildInvoiceModel(
    {
      currency,
      roomVatRate: ROOM_VAT_RATE_BP,
      rooms: [
        {
          amountTotal,
          roomName: parent.resource.name,
          durationMinutes: plan.durationMinutes,
          addOns: [],
        },
      ],
    },
    vat
  );

  const hours = plan.durationMinutes / 60;
  const lineName = `${parent.resource.name} — ${hours}h continuing your meeting`;
  const lines = [
    { name: lineName, quantity: 1, unitAmount: amountTotal },
    ...model.vatBreakdown
      .filter((v) => v.vat > 0)
      .map((v) => ({ name: `VAT ${v.vatRate / 100}%`, quantity: 1, unitAmount: v.vat })),
  ];

  try {
    const customerId = parent.bookerUserId
      ? ((await getNe26BillingProfileRepository().findStripeCustomerId(parent.bookerUserId)) ?? undefined)
      : undefined;
    const checkout = await getStripeCheckoutService().createCheckoutSession({
      orderUid: order.uid,
      orderNumber: order.orderNumber,
      currency,
      lines,
      customerEmail: parent.bookerEmail,
      customerId,
      // Stripe caps a session at 24 hours, so a continuation booked further
      // ahead than that gets a link that expires long before the room does.
      // That is the right way round: the room stays theirs, and an admin
      // reissues the link from the booking page.
      holdExpiresAt: new Date(checkoutExpiresAtSeconds(plan.startTime, now) * 1000),
      successUrl: `${input.webappUrl}/rooms/booked/${order.uid}`,
      cancelUrl: `${input.webappUrl}/rooms/admin/${parent.uid}`,
    });
    await orders.setStripeSessionId(order.uid, checkout.id);

    return {
      orderUid: order.uid,
      bookingUid: order.bookings[0].uid,
      checkoutUrl: checkout.url,
      bookerEmail: parent.bookerEmail,
      bookerName: parent.bookerName,
      roomName: parent.resource.name,
      slotLabel: formatSlotRange(plan.startTime, plan.endTime),
      parentSlotLabel: formatSlotRange(parent.startTime, parent.endTime),
      amountTotal,
      currency,
    };
  } catch (e) {
    // Same reasoning as a normal checkout: if Stripe fails at any step, give
    // the hour back rather than leaving it held against an order that can
    // never be paid. Nothing of the meeting's own is disturbed by that —
    // this never took its cleaning gap in the first place, which is exactly
    // why cancelling here is safe.
    await orders.cancelPending(order.uid).catch(() => undefined);
    if (e instanceof ErrorWithCode) throw e;
    throw new ErrorWithCode(
      ErrorCode.BadRequest,
      "We couldn't reach our payment provider. Nothing was charged and the extra time is free again — please try once more."
    );
  }
}
