-- NE26: the self-service cancellation window becomes an admin setting.
-- Seven days was hard-coded; keep that as the default so nothing moves on
-- deploy, and let the admin reopen or shorten the window from Settings.
ALTER TABLE "Ne26RoomSettings"
  ADD COLUMN IF NOT EXISTS "cancellationDeadlineDays" INTEGER NOT NULL DEFAULT 7;
