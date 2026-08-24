-- NE26: purchase order and internal reference.
--
-- Some exhibitors' finance departments will not pay an invoice that does not
-- carry their own PO number. Both are optional, and an empty one prints nothing
-- at all rather than an empty label.
--
-- Held in two places on purpose: on the profile so a returning buyer types it
-- once, and frozen onto the booking because a PO belongs to an order, and the
-- welcome desk sells to people who have no profile at all.
ALTER TABLE "Ne26BillingProfile" ADD COLUMN "poNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Ne26BillingProfile" ADD COLUMN "internalReference" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ResourceBooking" ADD COLUMN "bookerPoNumber" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerInternalReference" TEXT;
