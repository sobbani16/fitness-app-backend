-- CreateTable
CREATE TABLE "HealthScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "macroScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conditionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "foodQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreContributor" (
    "id" TEXT NOT NULL,
    "healthScoreId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "scoreImpact" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreContributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScoreInsight" (
    "id" TEXT NOT NULL,
    "healthScoreId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthScoreInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthScore_userId_date_idx" ON "HealthScore"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HealthScore_userId_date_key" ON "HealthScore"("userId", "date");

-- CreateIndex
CREATE INDEX "ScoreContributor_healthScoreId_idx" ON "ScoreContributor"("healthScoreId");

-- CreateIndex
CREATE INDEX "HealthScoreInsight_healthScoreId_idx" ON "HealthScoreInsight"("healthScoreId");

-- AddForeignKey
ALTER TABLE "ScoreContributor" ADD CONSTRAINT "ScoreContributor_healthScoreId_fkey" FOREIGN KEY ("healthScoreId") REFERENCES "HealthScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthScoreInsight" ADD CONSTRAINT "HealthScoreInsight_healthScoreId_fkey" FOREIGN KEY ("healthScoreId") REFERENCES "HealthScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
