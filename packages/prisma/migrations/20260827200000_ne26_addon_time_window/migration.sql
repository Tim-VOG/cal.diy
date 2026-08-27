-- NE26: an add-on can be limited to a time of day.
--
-- Booking a room at 09:00 still offered "Catering - Lunch", which reads as a
-- mistake to the exhibitor. Rather than hard-code mealtimes, the window is
-- stored on the add-on and edited in the admin: the caterer's hours are a
-- commercial decision that will move, and moving it must not need a deploy.
--
-- Minutes from midnight, event-local. Both NULL means always available, which
-- is what every existing add-on gets — no behaviour changes until a window is
-- set.
ALTER TABLE "AddOn" ADD COLUMN "availableFromMinute" INTEGER;
ALTER TABLE "AddOn" ADD COLUMN "availableToMinute" INTEGER;

-- The one window decided so far: lunch is served 11:00-14:00.
UPDATE "AddOn" SET "availableFromMinute" = 660, "availableToMinute" = 840
WHERE "slug" = 'catering-lunch';
