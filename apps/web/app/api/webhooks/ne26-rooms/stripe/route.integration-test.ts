import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@calcom/prisma";
import { ResourceBookingStatus } from "@calcom/prisma/enums";

// Stripe credentials must exist before the DI container builds its client.
// process.env is typed read-only in this repo, hence the widened alias.
const env = process.env as Record<string, string | undefined>;
env.STRIPE_PRIVATE_KEY ??= "sk_test_ne26_webhook_suite";
env.STRIPE_WEBHOOK_SECRET_NE26_ROOMS ??= "whsec_ne26_webhook_suite";

// Don't hit real SMTP; the invoice path runs for real otherwise (PDF included).
vi.mock("@calcom/features/ne26-rooms/lib/mailer", () => ({
  sendInvoiceEmail: vi.fn().mockResolvedValue(undefined),
  sendTeamEmail: vi.fn().mockResolvedValue(undefined),
}));

import Stripe from "stripe";
import { getResourceBookingRepository } from "@calcom/features/ne26-rooms/di/ResourceBookingRepository.container";
import { getAtomicSlotStarts } from "@calcom/features/ne26-rooms/lib/atomicSlots";
import { sendInvoiceEmail, sendTeamEmail } from "@calcom/features/ne26-rooms/lib/mailer";
import { POST } from "./route";

const repo = getResourceBookingRepository();
const stripe = new Stripe(env.STRIPE_PRIVATE_KEY as string, { apiVersion: "2020-08-27" });
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET_NE26_ROOMS as string;
const MS_PER_MINUTE = 60 * 1000;
const SLUG = `test-webhook-${Date.now()}`;
const TEAM_EMAIL = "sales@vo-europe.test";

let resourceId: number;
let slotCursor = 0;

/** A held booking on its own slot, so tests never collide with each other. */
async function heldBooking(overrides: { holdExpiresAt?: Date } = {}): Promise<string> {
  // Wednesday 09:00 Brussels onwards, one hour apart per booking.
  const startTime = new Date(Date.parse("2026-11-18T08:00:00.000Z") + slotCursor++ * 60 * MS_PER_MINUTE);
  const booking = await repo.createWithSlots({
    resourceId,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * MS_PER_MINUTE),
    durationMinutes: 60,
    slotStarts: getAtomicSlotStarts(startTime, 60),
    bookerEmail: "webhook@test.com",
    bookerName: "Webhook Tester",
    amountTotal: 35000,
    currency: "EUR",
    status: ResourceBookingStatus.PENDING,
    holdExpiresAt: overrides.holdExpiresAt ?? new Date(Date.now() + 35 * MS_PER_MINUTE),
  });
  return booking.uid;
}

interface SessionOptions {
  bookingUid?: string;
  paymentStatus?: string;
  source?: string;
  paymentIntent?: string;
}

function sessionEvent(type: string, options: SessionOptions = {}): string {
  return JSON.stringify({
    id: `evt_${Math.abs(slotCursor + type.length)}_${type}`,
    object: "event",
    type,
    data: {
      object: {
        id: "cs_test_webhook",
        object: "checkout.session",
        payment_status: options.paymentStatus ?? "paid",
        payment_intent: options.paymentIntent ?? "pi_test_webhook",
        amount_total: 35000,
        currency: "eur",
        customer_details: {
          name: "Webhook Buyer BV",
          address: { country: "NL" },
          tax_ids: [{ type: "eu_vat", value: "NL123456789B01" }],
        },
        metadata: {
          source: options.source ?? "ne26-rooms",
          ...(options.bookingUid ? { bookingUid: options.bookingUid } : {}),
        },
      },
    },
  });
}

function chargeEvent(paymentIntent: string, amount: number, amountRefunded: number): string {
  return JSON.stringify({
    id: `evt_charge_${amountRefunded}`,
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_webhook",
        object: "charge",
        amount,
        amount_refunded: amountRefunded,
        currency: "eur",
        payment_intent: paymentIntent,
      },
    },
  });
}

/** Deliver a payload with a valid signature, as Stripe would. */
function deliver(payload: string, secret: string = WEBHOOK_SECRET): Promise<Response> {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return POST(
    new Request("https://rooms.vo-eu.be/api/webhooks/ne26-rooms/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature, "content-type": "application/json" },
    })
  );
}

describe("NE26 Stripe webhook", () => {
  beforeAll(async () => {
    const room = await prisma.resource.create({
      data: { name: "TEST Webhook Room", slug: SLUG, category: "ENTRY", capacity: 6, surface: 18, price1h: 35000, price2h: 65000, price3h: 90000 },
      select: { id: true },
    });
    resourceId = room.id;

    // Team notifications go to the admin-configured list.
    await prisma.ne26InvoiceSettings.upsert({
      where: { id: 1 },
      update: { notifyEmails: TEAM_EMAIL },
      create: { id: 1, notifyEmails: TEAM_EMAIL },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await prisma.resourceBooking.deleteMany({ where: { resourceId } });
  });

  afterAll(async () => {
    await prisma.resource.delete({ where: { id: resourceId } });
  });

  describe("signature verification", () => {
    it("rejects a payload signed with the wrong secret", async () => {
      const uid = await heldBooking();
      const response = await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid }), "whsec_wrong");

      expect(response.status).toBe(400);
      // Critically, nothing was acted on.
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.PENDING);
    });

    it("rejects a payload with no signature at all", async () => {
      const response = await POST(
        new Request("https://rooms.vo-eu.be/api/webhooks/ne26-rooms/stripe", {
          method: "POST",
          body: sessionEvent("checkout.session.completed"),
        })
      );
      expect(response.status).toBe(400);
    });

    it("rejects a tampered payload that keeps a valid-looking signature", async () => {
      const uid = await heldBooking();
      const payload = sessionEvent("checkout.session.completed", { bookingUid: uid });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
      const tampered = payload.replace('"amount_total":35000', '"amount_total":100');

      const response = await POST(
        new Request("https://rooms.vo-eu.be/api/webhooks/ne26-rooms/stripe", {
          method: "POST",
          body: tampered,
          headers: { "stripe-signature": signature },
        })
      );

      expect(response.status).toBe(400);
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.PENDING);
    });
  });

  describe("checkout.session.completed", () => {
    it("confirms a paid session, records the payment and invoices it", async () => {
      const uid = await heldBooking();

      const response = await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid }));
      expect(response.status).toBe(200);

      const booking = await repo.findByUid(uid);
      expect(booking?.status).toBe(ResourceBookingStatus.CONFIRMED);
      expect(booking?.invoiceNumber).toMatch(/^NE26-2026-\d{4}$/);

      // Billing details Stripe collected drive the invoice VAT.
      const stored = await prisma.resourceBooking.findUniqueOrThrow({
        where: { uid },
        select: { stripePaymentId: true, bookerCountry: true, bookerVatNumber: true, bookerName: true },
      });
      expect(stored).toMatchObject({
        stripePaymentId: "pi_test_webhook",
        bookerCountry: "NL",
        bookerVatNumber: "NL123456789B01",
        bookerName: "Webhook Buyer BV",
      });

      // Also proves the SMTP mock is really in play: the real mailer throws
      // without EMAIL_SERVER_*, so a silently unmocked module would leave this
      // suite asserting a failing email path without saying so.
      expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
      expect(vi.mocked(sendInvoiceEmail).mock.calls[0][0]).toMatchObject({ to: "webhook@test.com" });

      // The team hears about the sale.
      expect(sendTeamEmail).toHaveBeenCalledTimes(1);
      const sale = vi.mocked(sendTeamEmail).mock.calls[0][0];
      expect(sale.to).toEqual([TEAM_EMAIL]);
      expect(sale.subject).toMatch(/room sold/i);
    });

    // The regression that matters most: SEPA and other delayed methods fire this
    // event immediately with payment_status "unpaid" and settle days later.
    it("does NOT confirm, invoice or allocate a number for an unpaid session", async () => {
      const uid = await heldBooking();

      const response = await deliver(
        sessionEvent("checkout.session.completed", { bookingUid: uid, paymentStatus: "unpaid" })
      );
      expect(response.status).toBe(200); // acknowledged, but not acted on

      const booking = await repo.findByUid(uid);
      expect(booking?.status).toBe(ResourceBookingStatus.PENDING);
      expect(booking?.invoiceNumber).toBeNull();
    });

    it("ignores a session belonging to another integration on the same account", async () => {
      const uid = await heldBooking();
      await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid, source: "cal-payments" }));
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.PENDING);
    });

    it("is a no-op on replay: the same delivery twice invoices once", async () => {
      const uid = await heldBooking();
      const payload = sessionEvent("checkout.session.completed", { bookingUid: uid });

      await deliver(payload);
      const first = await repo.findByUid(uid);
      await deliver(payload);
      const second = await repo.findByUid(uid);

      expect(second?.status).toBe(ResourceBookingStatus.CONFIRMED);
      expect(second?.invoiceNumber).toBe(first?.invoiceNumber);
    });

    it("does not resurrect a booking whose hold was already reclaimed", async () => {
      // Money captured against a booking that no longer exists: acknowledge the
      // delivery (so Stripe stops retrying) and get a human involved, because
      // nothing downstream retries and nobody reads container logs mid-event.
      const uid = await heldBooking();
      await prisma.resourceBooking.delete({ where: { uid } });

      const response = await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid }));

      expect(response.status).toBe(200);
      expect(await repo.findByUid(uid)).toBeNull();

      // Nobody reads container logs mid-event: this has to reach a human, with
      // enough to find the money in Stripe.
      expect(sendTeamEmail).toHaveBeenCalledTimes(1);
      const alert = vi.mocked(sendTeamEmail).mock.calls[0][0];
      expect(alert.subject).toMatch(/no matching booking/i);
      expect(alert.body).toContain("pi_test_webhook");
      expect(alert.body).toContain("cs_test_webhook");
    });
  });

  describe("delayed payments", () => {
    it("confirms when the payment later settles", async () => {
      const uid = await heldBooking();
      await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid, paymentStatus: "unpaid" }));
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.PENDING);

      await deliver(sessionEvent("checkout.session.async_payment_succeeded", { bookingUid: uid }));
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.CONFIRMED);
    });

    it("releases the hold when the payment fails, freeing the slot", async () => {
      const uid = await heldBooking();
      const { startTime } = await prisma.resourceBooking.findUniqueOrThrow({
        where: { uid },
        select: { startTime: true },
      });

      await deliver(
        sessionEvent("checkout.session.async_payment_failed", { bookingUid: uid, paymentStatus: "unpaid" })
      );

      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.CANCELLED);
      expect(await prisma.resourceSlot.count({ where: { resourceId, slotStart: startTime } })).toBe(0);
    });

    it("releases the hold when the session expires", async () => {
      const uid = await heldBooking();
      await deliver(sessionEvent("checkout.session.expired", { bookingUid: uid, paymentStatus: "unpaid" }));
      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.CANCELLED);
    });

    it("does not release a booking that is already paid", async () => {
      const uid = await heldBooking();
      await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid }));
      await deliver(sessionEvent("checkout.session.expired", { bookingUid: uid, paymentStatus: "unpaid" }));

      expect((await repo.findByUid(uid))?.status).toBe(ResourceBookingStatus.CONFIRMED);
    });
  });

  describe("charge.refunded", () => {
    async function paidBooking(paymentIntent: string): Promise<string> {
      const uid = await heldBooking();
      await deliver(sessionEvent("checkout.session.completed", { bookingUid: uid, paymentIntent }));
      vi.clearAllMocks();
      return uid;
    }

    // The other regression that matters: charge.refunded also fires for partial
    // refunds, and our credit note is all-or-nothing.
    it("does NOT credit or cancel on a partial refund", async () => {
      const uid = await paidBooking("pi_partial");
      const { startTime } = await prisma.resourceBooking.findUniqueOrThrow({
        where: { uid },
        select: { startTime: true },
      });

      const response = await deliver(chargeEvent("pi_partial", 35000, 5000));
      expect(response.status).toBe(200);

      const booking = await repo.findByUid(uid);
      expect(booking?.status).toBe(ResourceBookingStatus.CONFIRMED);
      expect(booking?.creditNoteNumber).toBeNull();
      // The room stays held by the exhibitor who still has it.
      expect(await prisma.resourceSlot.count({ where: { resourceId, slotStart: startTime } })).toBe(1);

      // Silence would mean the difference never gets invoiced.
      expect(sendTeamEmail).toHaveBeenCalledTimes(1);
      // Human amounts, not Stripe's minor units: "5000 of 35000" reads as a
      // 5000 EUR refund on a 35000 EUR booking to whoever has to act on it.
      expect(vi.mocked(sendTeamEmail).mock.calls[0][0].body).toContain("50.00 EUR of 350.00 EUR");
    });

    it("credits and frees the room on a full refund", async () => {
      const uid = await paidBooking("pi_full");
      const { startTime } = await prisma.resourceBooking.findUniqueOrThrow({
        where: { uid },
        select: { startTime: true },
      });

      await deliver(chargeEvent("pi_full", 35000, 35000));

      const booking = await repo.findByUid(uid);
      expect(booking?.status).toBe(ResourceBookingStatus.CANCELLED);
      expect(booking?.creditNoteNumber).toMatch(/^NE26-CN-2026-\d{4}$/);
      expect(await prisma.resourceSlot.count({ where: { resourceId, slotStart: startTime } })).toBe(0);
    });

    it("is a no-op on replay of a full refund", async () => {
      const uid = await paidBooking("pi_replay");
      const payload = chargeEvent("pi_replay", 35000, 35000);

      await deliver(payload);
      const first = (await repo.findByUid(uid))?.creditNoteNumber;
      await deliver(payload);

      expect((await repo.findByUid(uid))?.creditNoteNumber).toBe(first);
    });

    it("ignores a refund for a payment we know nothing about", async () => {
      const response = await deliver(chargeEvent("pi_unknown_to_us", 35000, 35000));
      expect(response.status).toBe(200);
    });
  });
});
