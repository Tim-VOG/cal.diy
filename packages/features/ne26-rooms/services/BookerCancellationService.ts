import { canBookerCancel, cancellationDeadline, refusalMessage } from "../lib/cancellationPolicy";
import { buildEventSchedule } from "../lib/eventSchedule";
import { orderRef } from "../lib/orderRef";
import type { InvoiceSettingsRepository } from "../repositories/InvoiceSettingsRepository";
import type { Ne26OrderRepository } from "../repositories/Ne26OrderRepository";
import type { Ne26RoomSettingsRepository } from "../repositories/Ne26RoomSettingsRepository";
import type { InvoiceService } from "./InvoiceService";

/** What the exhibitor's cancellation needs from Stripe, and nothing else. */
export interface RefundGateway {
  refundPayment(paymentIntentId: string, idempotencyKey: string, amount?: number): Promise<string>;
}

/** Telling the sales desk. Kept as a dependency so a test can read what was sent. */
export type TeamNotifier = (
  audience: "sales" | "ops",
  subject: string,
  body: string,
  html?: string
) => Promise<void>;

export interface IBookerCancellationDeps {
  ne26OrderRepository: Ne26OrderRepository;
  invoiceService: InvoiceService;
  refunds: RefundGateway;
  ne26RoomSettingsRepository: Ne26RoomSettingsRepository;
  invoiceSettingsRepository: InvoiceSettingsRepository;
  notifyTeam: TeamNotifier;
  /** Absolute base URL, for the link in the sales email. */
  webappUrl: string;
}

export class CancellationRefused extends Error {
  constructor(
    readonly reason: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * An exhibitor cancelling one room they have already paid for.
 *
 * Lives in a service rather than in the tRPC handler because it spends real
 * money: every branch — who may cancel, what is refunded, what happens when
 * Stripe refuses — is then exercised by tests with a Stripe that records what
 * it was asked for, instead of being believed.
 *
 * The order of operations is the one proven in production for a refund made by
 * hand: money back first, paperwork second. Everything after the refund is
 * best-effort and never undoes it — a credit note that fails is raised on the
 * dashboard, not hidden behind an error the exhibitor sees after being paid.
 */
export class BookerCancellationService {
  constructor(private deps: IBookerCancellationDeps) {}

  async cancel(
    bookingUid: string,
    bookerUserId: number,
    now: Date = new Date()
  ): Promise<{ amountTtc: number; creditNoteNumber: string | null; roomName: string }> {
    const orders = this.deps.ne26OrderRepository;
    const booking = await orders.findBookingForCancellation(bookingUid);
    // Not "forbidden": whose booking it is, is not this buyer's business.
    if (!booking?.order || booking.order.bookerUserId !== bookerUserId) {
      throw new CancellationRefused("not-found", "No such booking.");
    }

    const [roomSettings, invoiceSettings] = await Promise.all([
      this.deps.ne26RoomSettingsRepository.get(),
      this.deps.invoiceSettingsRepository.get(),
    ]);
    const deadline = cancellationDeadline(buildEventSchedule(roomSettings.eventDays));
    const verdict = canBookerCancel(booking, now, deadline);
    if (!verdict.allowed) {
      throw new CancellationRefused(
        verdict.reason,
        refusalMessage(verdict.reason, invoiceSettings.contactEmail || "the organisers")
      );
    }

    // Priced before anything moves: the refund and the credit note must agree to
    // the cent, so both come from this one figure.
    const quote = await this.deps.invoiceService.quoteCredit(booking.order.uid, [bookingUid]);
    if (!quote) {
      throw new CancellationRefused("not-creditable", "This room can no longer be cancelled.");
    }

    // Claimed BEFORE the refund: two clicks cannot pay out twice, and a room
    // already being cancelled is refused rather than refunded again.
    const claim = await orders.claimBookerCancellation(bookingUid, bookerUserId, now);
    if (!claim) {
      throw new CancellationRefused(
        "in-progress",
        "This booking is already being cancelled. Check your inbox in a few minutes."
      );
    }

    let refundId: string;
    try {
      refundId = await this.deps.refunds.refundPayment(
        claim.stripePaymentId,
        // Keyed on the room: Stripe replays the first refund rather than making
        // a second one, whatever the browser does.
        `ne26-cancel-${bookingUid}`,
        quote.amountTtc
      );
    } catch (e) {
      // Nothing was paid back, so hand the room back and let them try again.
      await orders.releaseBookerCancellationClaim(bookingUid);
      throw e;
    }

    const credited = await this.deps.invoiceService
      .creditBookings(claim.orderUid, [bookingUid], { stripeRefundId: refundId })
      .catch(() => null);

    if (credited) await this.tellTheDesk(claim.orderUid, bookingUid, quote.amountTtc, credited.number);

    return {
      amountTtc: quote.amountTtc,
      creditNoteNumber: credited?.number ?? null,
      roomName: booking.resource.name,
    };
  }

  /**
   * The desk hears about every room that comes back on sale, the same way it
   * hears about a refund made by hand in Stripe. Without this a room would
   * simply reappear as free, and the first anyone knew of it would be an
   * exhibitor asking for one that had just been given back.
   */
  private async tellTheDesk(
    orderUid: string,
    bookingUid: string,
    amountRefunded: number,
    creditNoteNumber: string
  ): Promise<void> {
    const { refundNotification } = await import("../lib/teamNotification");
    const order = await this.deps.ne26OrderRepository.findByUid(orderUid);
    const room = order?.bookings.find((b) => b.uid === bookingUid);
    if (!order || !room) return;

    const { subject, body, html } = refundNotification({
      orderRef: orderRef(order.orderNumber),
      rooms: [
        {
          roomName: room.resource.name,
          startUtc: room.startTime,
          endUtc: room.endTime,
          durationMinutes: room.durationMinutes,
          addOns: room.addOns.map((a) => ({
            name: a.addOn.name,
            quantity: a.quantity,
            lineTotal: a.lineTotal,
          })),
        },
      ],
      bookerCompany: order.bookerLegalName,
      bookerName: order.bookerName,
      bookerEmail: order.bookerEmail,
      amountRefunded,
      currency: order.currency,
      invoiceNumber: order.invoiceNumber,
      creditNoteNumber,
      stripeUrl: order.stripePaymentId
        ? `https://dashboard.stripe.com/payments/${order.stripePaymentId}`
        : null,
      adminUrl: `${this.deps.webappUrl}/rooms/admin/order/${order.uid}`,
    });
    await this.deps.notifyTeam("sales", `Cancelled by the exhibitor — ${subject}`, body, html);
  }
}
