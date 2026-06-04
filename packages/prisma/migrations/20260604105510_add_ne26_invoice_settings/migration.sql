-- CreateTable
CREATE TABLE "public"."Ne26InvoiceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT NOT NULL DEFAULT 'VO EUROPE SA',
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "addressLine1" TEXT NOT NULL DEFAULT '',
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'Belgium',
    "iban" TEXT NOT NULL DEFAULT '',
    "bic" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "legalFooter" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ne26InvoiceSettings_pkey" PRIMARY KEY ("id")
);
