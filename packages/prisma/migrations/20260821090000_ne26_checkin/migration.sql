-- NE26: the welcome desk marking an exhibitor as arrived.
--
-- A timestamp rather than a boolean, so the desk can see when someone turned up
-- and a mistaken check-in can be cleared without erasing that it happened. The
-- email is denormalised for the same reason the audit log denormalises it: the
-- desk runs on a shared tablet.
ALTER TABLE "ResourceBooking" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "ResourceBooking" ADD COLUMN "checkedInByEmail" TEXT;
