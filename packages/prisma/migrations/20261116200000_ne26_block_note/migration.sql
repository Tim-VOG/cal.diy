-- NE26: why a slot is blocked.
--
-- A block takes a room off sale and says nothing about why. At the counter
-- that is the difference between "the room is being rewired" and "somebody
-- blocked this by mistake", and a hostess facing an exhibitor cannot tell the
-- two apart. The note is read by the admin and by the welcome desk; it is
-- never shown to an exhibitor, because a block is not their business.
ALTER TABLE "ResourceBooking"
  ADD COLUMN IF NOT EXISTS "blockNote" TEXT;
