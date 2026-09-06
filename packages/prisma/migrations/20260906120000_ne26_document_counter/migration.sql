-- NE26: gapless invoice and credit-note numbering.
--
-- The two Postgres sequences are left in place but stop being used: nextval
-- consumes a number even when the transaction that asked for it rolls back, so
-- every failed PDF render burned a number out of a legally sequential series.
CREATE TABLE IF NOT EXISTS "Ne26DocumentCounter" (
  "series"     TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ne26DocumentCounter_pkey" PRIMARY KEY ("series")
);

-- Seeded from the documents that actually exist, not from the sequences: a
-- number the sequence burned but no document ever carried should be handed out
-- next, which is the whole point.
--
-- The two series are shaped differently — NE26-2026-0007 for an invoice,
-- NE26-CN-2026-0007 for a credit note — so the counter sits in a different
-- position. Reading the wrong one would restart the series and collide with a
-- document that already exists, on a unique column.
INSERT INTO "Ne26DocumentCounter" ("series", "lastNumber", "updatedAt")
SELECT 'invoice', COALESCE(MAX(n), 0), CURRENT_TIMESTAMP
FROM (
  SELECT CAST(split_part("invoiceNumber", '-', 3) AS INTEGER) AS n
  FROM "Ne26Order" WHERE "invoiceNumber" ~ '^NE26-[0-9]{4}-[0-9]+$'
  UNION ALL
  SELECT CAST(split_part("invoiceNumber", '-', 3) AS INTEGER) AS n
  FROM "ResourceBooking" WHERE "invoiceNumber" ~ '^NE26-[0-9]{4}-[0-9]+$'
) AS used
ON CONFLICT ("series") DO NOTHING;

INSERT INTO "Ne26DocumentCounter" ("series", "lastNumber", "updatedAt")
SELECT 'credit-note', COALESCE(MAX(n), 0), CURRENT_TIMESTAMP
FROM (
  SELECT CAST(split_part("creditNoteNumber", '-', 4) AS INTEGER) AS n
  FROM "Ne26Order" WHERE "creditNoteNumber" ~ '^NE26-CN-[0-9]{4}-[0-9]+$'
  UNION ALL
  SELECT CAST(split_part("creditNoteNumber", '-', 4) AS INTEGER) AS n
  FROM "ResourceBooking" WHERE "creditNoteNumber" ~ '^NE26-CN-[0-9]{4}-[0-9]+$'
) AS used
ON CONFLICT ("series") DO NOTHING;
