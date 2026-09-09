-- NE26: let a footer link open in a new tab.
--
-- Additive with a default and no UPDATE: every existing link keeps opening in
-- the same tab, so the rendered footer does not change until somebody ticks
-- the box.
ALTER TABLE "Ne26LegalPage" ADD COLUMN "footerNewTab" BOOLEAN NOT NULL DEFAULT false;
