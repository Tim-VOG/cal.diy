-- AlterTable
ALTER TABLE "public"."Ne26InvoiceSettings" ADD COLUMN     "euReverseChargeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "euReverseChargeMention" TEXT NOT NULL DEFAULT 'VAT reverse charge - Article 196 of Council Directive 2006/112/EC',
ADD COLUMN     "nonEuExemptEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nonEuExemptMention" TEXT NOT NULL DEFAULT 'VAT not applicable - supply outside the scope of EU VAT';

-- AlterTable
ALTER TABLE "public"."ResourceBooking" ADD COLUMN     "bookerCountry" TEXT,
ADD COLUMN     "bookerVatNumber" TEXT;
