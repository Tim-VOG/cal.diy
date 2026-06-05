-- Admin-managed legal / informational pages for the NE26 rooms platform.
CREATE TABLE "Ne26LegalPage" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ne26LegalPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ne26LegalPage_slug_key" ON "Ne26LegalPage"("slug");

-- Seed the two pages linked from the site footer so the links resolve
-- immediately; the admin edits the real content from the "Pages" tab.
INSERT INTO "Ne26LegalPage" ("slug", "title", "content", "published", "updatedAt")
VALUES
  ('privacy-policy', 'Privacy Policy', '_This page is being prepared._', true, CURRENT_TIMESTAMP),
  ('practical-information', 'Practical Information & Legal Framework', '_This page is being prepared._', true, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
