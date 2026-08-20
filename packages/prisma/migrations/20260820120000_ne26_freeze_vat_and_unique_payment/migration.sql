-- NE26 Rooms: freeze the VAT treatment onto the order, and make one Stripe
-- payment back at most one booking.
--
-- Why: nothing froze VAT. An admin correcting the catering rate, or switching
-- reverse charge on, changed the VAT split recomputed for the CREDIT NOTE of an
-- already-issued invoice. The invoice PDF is stored and does not change, so the
-- two documents silently disagreed — an accounting defect. Add-on lines already
-- froze unitPrice and lineTotal, but not the rate.

-- 1. Freeze the rate on each ordered add-on line, then backfill from the
--    catalogue so existing lines keep the rate they were actually sold at.
ALTER TABLE "BookingAddOn" ADD COLUMN "vatRate" INTEGER NOT NULL DEFAULT 2100;

UPDATE "BookingAddOn" AS ba
SET "vatRate" = a."vatRate"
FROM "AddOn" AS a
WHERE ba."addOnId" = a."id";

-- 2. Freeze the booking-level treatment, written when the invoice is issued
--    (that is when the buyer's country is finally known, from Stripe Checkout).
--    NULL means "not invoiced yet".
ALTER TABLE "ResourceBooking" ADD COLUMN "roomVatRate" INTEGER;
ALTER TABLE "ResourceBooking" ADD COLUMN "vatZeroRated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ResourceBooking" ADD COLUMN "vatMention" TEXT;

-- Already-invoiced bookings were all issued at the hardcoded 21% room rate.
UPDATE "ResourceBooking" SET "roomVatRate" = 2100 WHERE "invoiceNumber" IS NOT NULL;

-- 3. One payment, one booking. NULLs stay unconstrained in Postgres, so unpaid
--    bookings are unaffected. If this fails on a real database, two bookings
--    share a payment intent and that must be reconciled by hand first:
--      SELECT "stripePaymentId", count(*) FROM "ResourceBooking"
--      WHERE "stripePaymentId" IS NOT NULL
--      GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX "ResourceBooking_stripePaymentId_key" ON "ResourceBooking"("stripePaymentId");
