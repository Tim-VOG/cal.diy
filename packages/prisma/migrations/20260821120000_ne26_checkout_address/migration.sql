-- NE26: the billing address as confirmed at Checkout.
--
-- Counter sales have no account behind them: the welcome desk knows a name and
-- an email, nothing more. The invoice still needs an address, so Stripe collects
-- one and it is kept here rather than on a billing profile that does not exist.
--
-- Web bookings leave these empty and keep taking the address from the
-- exhibitor's profile, which is the source of truth there.
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerLegalName" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerAddressLine1" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerAddressLine2" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerPostalCode" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerCity" TEXT;
