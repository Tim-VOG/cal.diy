-- NE26: the name on the door, when it differs from the name the room is sold
-- under. Null means the two are the same.
ALTER TABLE "Resource" ADD COLUMN "venueName" TEXT;

-- The venue numbering settled on 30 October 2026. It reorders the rooms on
-- purpose: Meeting 3 and 4 are the LARGE rooms, sitting between the small ones,
-- so a door number says nothing about size or price.
--
-- Matched on the slug, and only where nothing has been set yet, so that a name
-- corrected in ADMIN > Rooms is never overwritten by a re-run.
UPDATE "Resource" AS r
SET "venueName" = v.door
FROM (
  VALUES
    ('small-room-1', 'Meeting 1'),
    ('small-room-2', 'Meeting 2'),
    ('large-room-1', 'Meeting 3'),
    ('large-room-2', 'Meeting 4'),
    ('small-room-3', 'Meeting 5'),
    ('small-room-4', 'Meeting 6'),
    ('small-room-5', 'Meeting 7')
) AS v(slug, door)
WHERE r.slug = v.slug AND r."venueName" IS NULL;

-- The two suites keep one name on both sides, so they are left null rather than
-- repeated: the desk then shows "Suite 1" once instead of twice.
