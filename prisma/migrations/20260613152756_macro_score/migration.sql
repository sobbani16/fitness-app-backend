-- AlterTable
ALTER TABLE "FoodLog" ADD COLUMN     "fiberG" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MacroGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "caloriesTarget" DOUBLE PRECISION NOT NULL DEFAULT 2200,
    "proteinTarget" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "carbsTarget" DOUBLE PRECISION NOT NULL DEFAULT 250,
    "fatTarget" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "fiberTarget" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "waterMlTarget" INTEGER NOT NULL DEFAULT 2000,
    "source" TEXT NOT NULL DEFAULT 'default',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMacroScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "proteinScore" DOUBLE PRECISION NOT NULL,
    "carbsScore" DOUBLE PRECISION NOT NULL,
    "fatScore" DOUBLE PRECISION NOT NULL,
    "fiberScore" DOUBLE PRECISION NOT NULL,
    "hydrationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proteinG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbsG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fatG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fiberG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterMl" INTEGER NOT NULL DEFAULT 0,
    "calories" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyMacroScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MacroGoal_userId_key" ON "MacroGoal"("userId");

-- CreateIndex
CREATE INDEX "DailyMacroScore_userId_date_idx" ON "DailyMacroScore"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMacroScore_userId_date_key" ON "DailyMacroScore"("userId", "date");
