-- CreateTable
CREATE TABLE "ScannedLabel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productName" TEXT,
    "ingredients" TEXT,
    "servingSizeG" DOUBLE PRECISION NOT NULL,
    "servingsPerContainer" DOUBLE PRECISION,
    "labelCalories" DOUBLE PRECISION NOT NULL,
    "labelProteinG" DOUBLE PRECISION NOT NULL,
    "labelCarbsG" DOUBLE PRECISION NOT NULL,
    "labelFatG" DOUBLE PRECISION NOT NULL,
    "labelFiberG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labelSugarG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labelSodiumMg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualPortionG" DOUBLE PRECISION NOT NULL,
    "adjCalories" DOUBLE PRECISION NOT NULL,
    "adjProteinG" DOUBLE PRECISION NOT NULL,
    "adjCarbsG" DOUBLE PRECISION NOT NULL,
    "adjFatG" DOUBLE PRECISION NOT NULL,
    "adjFiberG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjSugarG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foodLogId" TEXT,
    "photoUri" TEXT,
    "ocrRawText" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "mealType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannedLabel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScannedLabel_userId_createdAt_idx" ON "ScannedLabel"("userId", "createdAt");
