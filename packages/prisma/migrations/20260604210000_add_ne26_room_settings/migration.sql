-- CreateTable
CREATE TABLE "Ne26RoomSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ne26RoomSettings_pkey" PRIMARY KEY ("id")
);
