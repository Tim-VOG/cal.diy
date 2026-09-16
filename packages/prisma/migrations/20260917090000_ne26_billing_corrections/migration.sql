-- NE26: admin corrections to an order's billing block.
-- Additive only: four nullable columns, no row rewritten.
ALTER TABLE "Ne26Order" ADD COLUMN "bookerRegion" TEXT;
ALTER TABLE "Ne26Order" ADD COLUMN "billingCorrectedAt" TIMESTAMP(3);
ALTER TABLE "Ne26Order" ADD COLUMN "invoiceIssuedAt" TIMESTAMP(3);
ALTER TABLE "Ne26Order" ADD COLUMN "creditNoteIssuedAt" TIMESTAMP(3);
