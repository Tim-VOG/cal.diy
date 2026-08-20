-- NE26 Rooms: who receives team notifications (a sale, a Stripe capture with no
-- matching booking, a partial refund needing manual paperwork).
--
-- Comma-separated and admin-editable, so the sales team can be added without a
-- redeploy. Empty falls back to contactEmail.
ALTER TABLE "Ne26InvoiceSettings" ADD COLUMN "notifyEmails" TEXT NOT NULL DEFAULT '';
