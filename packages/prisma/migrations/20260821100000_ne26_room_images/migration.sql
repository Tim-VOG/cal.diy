-- NE26: room photos uploaded from the admin.
--
-- In the database rather than on disk, following Cal's own Avatar model. The
-- deployment writes container-local paths that a redeploy wipes — that already
-- cost us once with invoice PDFs — so keeping the photos here means they are
-- covered by the existing backup, with no volume for anyone to remember to
-- mount.
CREATE TABLE "Ne26RoomImage" (
    "key" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "uploadedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ne26RoomImage_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "Ne26RoomImage_createdAt_idx" ON "Ne26RoomImage"("createdAt");
