-- NE26: how many rooms one exhibitor may hold per event day.
--
-- The rule was the constant 1, enforced in the order service. It is a
-- commercial decision, not a technical guard -- the thing that stops two
-- people taking one room is the unique index on (resourceId, slotStart), which
-- this does not touch -- so it belongs in the settings an admin can change
-- during the event rather than in a release.
--
-- Default 1 keeps today's behaviour exactly: every existing install reads the
-- same rule it enforced before this column existed.
ALTER TABLE "Ne26RoomSettings"
  ADD COLUMN IF NOT EXISTS "maxRoomsPerDayPerExhibitor" INTEGER NOT NULL DEFAULT 1;
