-- CreateTable
CREATE TABLE "BarcodeFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BarcodeFavorite_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProductCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCorrection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BarcodeFavorite_userId_barcode_key" ON "BarcodeFavorite"("userId", "barcode");
CREATE INDEX "BarcodeFavorite_userId_idx" ON "BarcodeFavorite"("userId");
CREATE INDEX "ProductCorrection_barcode_idx" ON "ProductCorrection"("barcode");
CREATE INDEX "ProductCorrection_userId_idx" ON "ProductCorrection"("userId");
ALTER TABLE "UserMindPreferences" ADD COLUMN "reminderTimeLocal" TEXT,
ADD COLUMN "reminderTimeZone" TEXT,
ADD COLUMN "reminderPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quietHoursStart" TEXT,
ADD COLUMN "quietHoursEnd" TEXT;
