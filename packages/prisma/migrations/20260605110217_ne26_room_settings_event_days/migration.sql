-- Per-day opening hours for the NE26 rooms platform (nullable; null = built-in defaults).
ALTER TABLE "Ne26RoomSettings" ADD COLUMN "eventDays" JSONB;
