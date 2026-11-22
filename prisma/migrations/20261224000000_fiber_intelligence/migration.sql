-- Smart Fiber Intelligence — additive only, fully reversible.
-- Contains ONLY this feature's changes; pre-existing drift
-- (Recipe_reviewStatus_idx / Recipe_sourceKey_key) is intentionally excluded.

-- AlterTable
ALTER TABLE "MacroGoal" ADD COLUMN     "fiberTargetBasis" TEXT,
ADD COLUMN     "fiberTargetNote" TEXT;

-- AlterTable
ALTER TABLE "RecipeIngredient" ADD COLUMN     "fiberG" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "FiberDailyRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "inputsHash" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "targetG" DOUBLE PRECISION,
    "confirmedG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedG" DOUBLE PRECISION,
    "unknownMeals" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiberDailyRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiberSupplementCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplementId" TEXT,
    "productId" TEXT,
    "outcome" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "labelFiberG" DOUBLE PRECISION,
    "servingKnown" BOOLEAN NOT NULL DEFAULT false,
    "ruleVersion" TEXT NOT NULL,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiberSupplementCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiberDailyRecommendation_userId_date_idx" ON "FiberDailyRecommendation"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FiberDailyRecommendation_userId_date_key" ON "FiberDailyRecommendation"("userId", "date");

-- CreateIndex
CREATE INDEX "FiberSupplementCheck_userId_createdAt_idx" ON "FiberSupplementCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FiberSupplementCheck_supplementId_idx" ON "FiberSupplementCheck"("supplementId");
