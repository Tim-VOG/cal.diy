-- NE26: credit notes become rows of their own, so one invoice can be credited
-- room by room when an exhibitor cancels part of a payment.
--
-- Additive: the credit note that CLOSES an order still lands on Ne26Order
-- (creditNoteNumber / creditNotePdfUrl / creditNoteIssuedAt), so every screen,
-- export and link that reads those keeps reading them.
CREATE TABLE "Ne26CreditNote" (
  "id" SERIAL NOT NULL,
  "number" TEXT NOT NULL,
  "orderUid" TEXT NOT NULL,
  "amountHt" INTEGER NOT NULL,
  "amountVat" INTEGER NOT NULL,
  "amountTtc" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "closesOrder" BOOLEAN NOT NULL DEFAULT false,
  "stripeRefundId" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ne26CreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Ne26CreditNote_number_key" ON "Ne26CreditNote"("number");
CREATE INDEX "Ne26CreditNote_orderUid_idx" ON "Ne26CreditNote"("orderUid");
ALTER TABLE "Ne26CreditNote" ADD CONSTRAINT "Ne26CreditNote_orderUid_fkey"
  FOREIGN KEY ("orderUid") REFERENCES "Ne26Order"("uid") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResourceBooking" ADD COLUMN "creditNoteId" INTEGER;
ALTER TABLE "ResourceBooking" ADD COLUMN "bookerCancelledAt" TIMESTAMP(3);
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_creditNoteId_fkey"
  FOREIGN KEY ("creditNoteId") REFERENCES "Ne26CreditNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Credit notes issued before this table existed: one row each, covering every
-- room on the order, so the archive and the exports see one history.
INSERT INTO "Ne26CreditNote" ("number", "orderUid", "amountHt", "amountVat", "amountTtc", "currency", "closesOrder", "issuedAt")
SELECT o."creditNoteNumber", o."uid", o."amountTotal", 0, o."amountTotal", o."currency", true,
       COALESCE(o."creditNoteIssuedAt", o."updatedAt")
FROM "Ne26Order" o
WHERE o."creditNoteNumber" IS NOT NULL;

UPDATE "ResourceBooking" b
SET "creditNoteId" = cn."id"
FROM "Ne26CreditNote" cn
WHERE b."orderUid" = cn."orderUid";
