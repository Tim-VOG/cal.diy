-- NE26: the PIN that releases desk mode.
--
-- The welcome-desk tablet runs on an admin session, so this PIN is what stands
-- between a counter and the pricing, refunds and accounts. Stored as salt:hash,
-- never in clear.
--
-- A four-digit PIN is only 10 000 guesses, so failures are counted and the exit
-- locks for a few minutes after a handful of them: enough to make a script
-- useless without punishing a hostess who mistypes.
ALTER TABLE "Ne26RoomSettings" ADD COLUMN "deskPinHash" TEXT;
ALTER TABLE "Ne26RoomSettings" ADD COLUMN "deskPinFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ne26RoomSettings" ADD COLUMN "deskPinLockedUntil" TIMESTAMP(3);
