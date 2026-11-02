-- NE26: catering sold for a room that was already booked and paid for.
--
-- A top-up is a full order of its own: its own Stripe payment, its own invoice,
-- its own credit note when it is cancelled. It owns no ResourceBooking and
-- claims no ResourceSlot, so the anti-double-booking constraint is untouched by
-- anything here.

-- Which order paid for an add-on line. The room's own order for everything sold
-- so far; a top-up's order from now on. Without it, crediting one room would
-- refund every cover ever added to it against a single payment intent.
ALTER TABLE "BookingAddOn" ADD COLUMN "orderUid" TEXT;

-- Everything already sold was paid for by the order that bought the room.
UPDATE "BookingAddOn" ba
SET "orderUid" = rb."orderUid"
FROM "ResourceBooking" rb
WHERE ba."bookingId" = rb."id" AND rb."orderUid" IS NOT NULL;

CREATE INDEX "BookingAddOn_orderUid_idx" ON "BookingAddOn"("orderUid");

ALTER TABLE "BookingAddOn"
  ADD CONSTRAINT "BookingAddOn_orderUid_fkey" FOREIGN KEY ("orderUid")
  REFERENCES "Ne26Order"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

-- The room a top-up completes, and the lines it will create once it is paid.
-- The lines wait here rather than as BookingAddOn rows so an unpaid top-up
-- never reaches the kitchen sheet, an invoice or a revenue total.
ALTER TABLE "Ne26Order" ADD COLUMN "parentBookingUid" TEXT;
ALTER TABLE "Ne26Order" ADD COLUMN "pendingAddOnLines" JSONB;

CREATE INDEX "Ne26Order_parentBookingUid_idx" ON "Ne26Order"("parentBookingUid");

ALTER TABLE "Ne26Order"
  ADD CONSTRAINT "Ne26Order_parentBookingUid_fkey" FOREIGN KEY ("parentBookingUid")
  REFERENCES "ResourceBooking"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
