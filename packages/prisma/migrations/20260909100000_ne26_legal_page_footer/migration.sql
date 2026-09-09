-- NE26: choose which pages the footer lists, and in what order.

ALTER TABLE "Ne26LegalPage" ADD COLUMN "footerColumn" TEXT;
ALTER TABLE "Ne26LegalPage" ADD COLUMN "footerOrder" INTEGER NOT NULL DEFAULT 0;

-- The two links the footer had hard-coded, written down as data so the rendered
-- footer is identical the moment this lands. Without this the footer would come
-- back empty of page links, which is the one outcome nobody asked for.
UPDATE "Ne26LegalPage" SET "footerColumn" = 'privacy', "footerOrder" = 0 WHERE "slug" = 'privacy-policy';
UPDATE "Ne26LegalPage" SET "footerColumn" = 'more',    "footerOrder" = 0 WHERE "slug" = 'practical-information';
