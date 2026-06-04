ALTER TABLE "ResourceBooking" ADD COLUMN "creditNoteNumber" TEXT;
ALTER TABLE "ResourceBooking" ADD COLUMN "creditNotePdfUrl" TEXT;
CREATE UNIQUE INDEX "ResourceBooking_creditNoteNumber_key" ON "ResourceBooking"("creditNoteNumber");
