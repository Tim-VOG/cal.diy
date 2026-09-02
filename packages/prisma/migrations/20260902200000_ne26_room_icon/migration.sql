-- NE26: the glyph shown for a room that has no photograph yet.
-- Null keeps the previous behaviour: a default chosen from the room's category.
ALTER TABLE "Resource" ADD COLUMN "iconName" TEXT;
