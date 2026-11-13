-- NE26: the welcome desk can record that an exhibitor asked to cancel a room.
-- Recording the ask is all it does — no refund, no slot released — so these
-- columns are a trace an admin acts on, never a state the money reads.
ALTER TABLE "ResourceBooking"
  ADD COLUMN IF NOT EXISTS "cancellationRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationRequestedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "cancellationRequestNote" TEXT;
