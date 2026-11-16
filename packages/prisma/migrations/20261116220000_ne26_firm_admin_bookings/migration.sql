-- NE26: a booking an admin made at the exhibitor's request never lapses.
--
-- Extra time sold from the admin was given a deadline -- it was held until the
-- booking would have begun -- on the reasoning that an emailed payment link
-- needs to outlive a 35-minute checkout. That was the wrong rule. An admin
-- only creates one of these because the exhibitor asked for it: the room is
-- theirs and the money is owed whether or not they turn up, so nothing may
-- release it for want of payment.
--
-- A NULL deadline is what the code now reads as "firm": every query that asks
-- whether a booking still holds its slot accepts it, and the sweeper that
-- frees abandoned holds matches only a deadline in the PAST, which NULL never
-- is.
--
-- This clears the deadline on the continuations already sold. Without it the
-- one live in production would have freed its room the morning it was due,
-- putting two paid-for hours back on sale.
UPDATE "ResourceBooking"
   SET "holdExpiresAt" = NULL
 WHERE "extendsBookingUid" IS NOT NULL
   AND status = 'PENDING';

UPDATE "Ne26Order"
   SET "holdExpiresAt" = NULL
 WHERE status = 'PENDING'
   AND uid IN (
     SELECT "orderUid" FROM "ResourceBooking"
      WHERE "extendsBookingUid" IS NOT NULL AND "orderUid" IS NOT NULL
   );
