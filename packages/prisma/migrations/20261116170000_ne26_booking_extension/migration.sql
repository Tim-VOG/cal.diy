-- NE26: a booking that continues another one, in the same room, back to back.
--
-- An exhibitor asks the desk to start earlier or run later. It is sold as a
-- SECOND booking priced at its own duration, not as an edit of the first: the
-- package prices are per duration and deliberately not proportional, so there
-- is no such thing as the price of a fourth hour.
--
-- This column is what makes the pair legible afterwards -- on the invoice,
-- which has to say what the charge continues, and to anyone reading the room's
-- day and wondering why two bookings touch with no cleaning gap between them.
ALTER TABLE "ResourceBooking"
  ADD COLUMN IF NOT EXISTS "extendsBookingUid" TEXT;

-- Finding a booking's extensions, and the one-per-side check. Not unique: a
-- booking can be extended on both sides, and over time more than once.
CREATE INDEX IF NOT EXISTS "ResourceBooking_extendsBookingUid_idx"
  ON "ResourceBooking" ("extendsBookingUid");
