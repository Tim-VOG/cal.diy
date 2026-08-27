-- NE26: one payment, one invoice, one or more rooms.
--
-- An exhibitor booking three rooms expects to pay once and receive one invoice,
-- exactly as they pay once for a room and its add-ons. Until now a payment could
-- only ever back a single booking, enforced by a unique index on
-- ResourceBooking.stripePaymentId — so three rooms meant three checkouts and
-- three invoices.
--
-- The money, the document and the VAT treatment move here. A booking becomes one
-- room inside an order, and the uniqueness that stops a payment being processed
-- twice moves with it.
CREATE TABLE "Ne26Order" (
    "uid" TEXT NOT NULL,
    "bookerUserId" INTEGER,
    "bookerEmail" TEXT NOT NULL,
    "bookerName" TEXT NOT NULL,
    "bookerCountry" TEXT,
    "bookerVatNumber" TEXT,
    "bookerLegalName" TEXT,
    "bookerAddressLine1" TEXT,
    "bookerAddressLine2" TEXT,
    "bookerPostalCode" TEXT,
    "bookerCity" TEXT,
    "bookerPoNumber" TEXT,
    "bookerInternalReference" TEXT,
    "amountTotal" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "ResourceBookingStatus" NOT NULL DEFAULT 'PENDING',
    "holdExpiresAt" TIMESTAMP(3),
    "stripePaymentId" TEXT,
    "invoiceNumber" TEXT,
    "invoicePdfUrl" TEXT,
    "creditNoteNumber" TEXT,
    "creditNotePdfUrl" TEXT,
    "roomVatRate" INTEGER,
    "vatZeroRated" BOOLEAN NOT NULL DEFAULT false,
    "vatMention" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ne26Order_pkey" PRIMARY KEY ("uid")
);

CREATE UNIQUE INDEX "Ne26Order_stripePaymentId_key" ON "Ne26Order"("stripePaymentId");
CREATE UNIQUE INDEX "Ne26Order_invoiceNumber_key" ON "Ne26Order"("invoiceNumber");
CREATE UNIQUE INDEX "Ne26Order_creditNoteNumber_key" ON "Ne26Order"("creditNoteNumber");
CREATE INDEX "Ne26Order_bookerUserId_idx" ON "Ne26Order"("bookerUserId");
CREATE INDEX "Ne26Order_status_holdExpiresAt_idx" ON "Ne26Order"("status", "holdExpiresAt");

ALTER TABLE "ResourceBooking" ADD COLUMN "orderUid" TEXT;
CREATE INDEX "ResourceBooking_orderUid_idx" ON "ResourceBooking"("orderUid");

-- Cascade: cancelling an unpaid order releases every room it was holding, and
-- the slot rows go with them. A confirmed order is never deleted.
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_orderUid_fkey"
    FOREIGN KEY ("orderUid") REFERENCES "Ne26Order"("uid") ON DELETE CASCADE ON UPDATE CASCADE;
