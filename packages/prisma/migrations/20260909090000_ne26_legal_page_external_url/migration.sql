-- NE26: a legal page can point at a document instead of holding one.
--
-- Additive and nullable: every existing row keeps its content and behaves
-- exactly as before, because the redirect only happens where this is set.
ALTER TABLE "Ne26LegalPage" ADD COLUMN "externalUrl" TEXT;
