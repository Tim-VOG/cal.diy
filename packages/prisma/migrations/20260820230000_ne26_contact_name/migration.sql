-- NE26: who to ask for at the door.
--
-- The billing profile carried a legal name (the company) but no human name, and
-- signup only collects an email — so a booking could only be traced back to
-- "tleskens-vo-group-be". The welcome team, the hostess tablet and post-event
-- reconciliation all need a first and last name.
--
-- Defaulted to '' rather than made NOT NULL: the existing rows predate this and
-- must not block the migration. isBillingProfileComplete() is what enforces the
-- fields being filled in, so those profiles are simply incomplete until their
-- owner completes them — the same guard exhibitors already go through.
ALTER TABLE "Ne26BillingProfile" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Ne26BillingProfile" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
