-- NE26: "VAT for Belgian buyers only".
--
-- The rule the business settled on: Belgian companies are charged Belgian VAT,
-- everybody else is not. Zero-rating then depends on the buyer's country alone,
-- so no VAT number is consulted and VIES verification never enters the picture
-- — which is what had kept EU buyers paying 21% they should not have paid.
--
-- Defaults to false so the setting has to be turned on deliberately: it changes
-- what is charged, and a migration must never quietly reprice anything.
ALTER TABLE "Ne26InvoiceSettings" ADD COLUMN "vatOnlyForBelgium" BOOLEAN NOT NULL DEFAULT false;
