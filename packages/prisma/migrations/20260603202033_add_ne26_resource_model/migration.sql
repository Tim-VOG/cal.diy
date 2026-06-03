-- CreateEnum
CREATE TYPE "public"."ResourceCategory" AS ENUM ('PREMIUM', 'INTERMEDIATE', 'ENTRY');

-- CreateEnum
CREATE TYPE "public"."ResourceBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."AddOnPriceType" AS ENUM ('FLAT', 'PER_PERSON', 'PER_HOUR');

-- CreateTable
CREATE TABLE "public"."Resource" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "public"."ResourceCategory" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "surface" INTEGER NOT NULL,
    "price1h" INTEGER NOT NULL,
    "price2h" INTEGER NOT NULL,
    "price3h" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownerUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResourceBooking" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "resourceId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "bookerUserId" INTEGER,
    "bookerEmail" TEXT NOT NULL,
    "bookerName" TEXT NOT NULL,
    "status" "public"."ResourceBookingStatus" NOT NULL DEFAULT 'PENDING',
    "holdExpiresAt" TIMESTAMP(3),
    "amountTotal" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "stripePaymentId" TEXT,
    "invoiceNumber" TEXT,
    "invoicePdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResourceSlot" (
    "id" SERIAL NOT NULL,
    "resourceId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AddOn" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceType" "public"."AddOnPriceType" NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 2100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingAddOn" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "addOnId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "BookingAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Resource_slug_key" ON "public"."Resource"("slug");

-- CreateIndex
CREATE INDEX "Resource_ownerUserId_idx" ON "public"."Resource"("ownerUserId");

-- CreateIndex
CREATE INDEX "Resource_isActive_idx" ON "public"."Resource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceBooking_uid_key" ON "public"."ResourceBooking"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceBooking_invoiceNumber_key" ON "public"."ResourceBooking"("invoiceNumber");

-- CreateIndex
CREATE INDEX "ResourceBooking_resourceId_idx" ON "public"."ResourceBooking"("resourceId");

-- CreateIndex
CREATE INDEX "ResourceBooking_bookerUserId_idx" ON "public"."ResourceBooking"("bookerUserId");

-- CreateIndex
CREATE INDEX "ResourceBooking_status_idx" ON "public"."ResourceBooking"("status");

-- CreateIndex
CREATE INDEX "ResourceBooking_startTime_endTime_idx" ON "public"."ResourceBooking"("startTime", "endTime");

-- CreateIndex
CREATE INDEX "ResourceBooking_status_holdExpiresAt_idx" ON "public"."ResourceBooking"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "ResourceSlot_bookingId_idx" ON "public"."ResourceSlot"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceSlot_resourceId_slotStart_key" ON "public"."ResourceSlot"("resourceId", "slotStart");

-- CreateIndex
CREATE UNIQUE INDEX "AddOn_slug_key" ON "public"."AddOn"("slug");

-- CreateIndex
CREATE INDEX "AddOn_isActive_idx" ON "public"."AddOn"("isActive");

-- CreateIndex
CREATE INDEX "BookingAddOn_bookingId_idx" ON "public"."BookingAddOn"("bookingId");

-- CreateIndex
CREATE INDEX "BookingAddOn_addOnId_idx" ON "public"."BookingAddOn"("addOnId");

-- AddForeignKey
ALTER TABLE "public"."Resource" ADD CONSTRAINT "Resource_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceBooking" ADD CONSTRAINT "ResourceBooking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "public"."Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceBooking" ADD CONSTRAINT "ResourceBooking_bookerUserId_fkey" FOREIGN KEY ("bookerUserId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceSlot" ADD CONSTRAINT "ResourceSlot_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "public"."Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceSlot" ADD CONSTRAINT "ResourceSlot_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."ResourceBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingAddOn" ADD CONSTRAINT "BookingAddOn_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."ResourceBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingAddOn" ADD CONSTRAINT "BookingAddOn_addOnId_fkey" FOREIGN KEY ("addOnId") REFERENCES "public"."AddOn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
