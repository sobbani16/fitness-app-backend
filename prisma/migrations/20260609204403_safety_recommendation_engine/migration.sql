-- CreateTable
CREATE TABLE "IngredientAttribute" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementAttribute" (
    "id" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionRule" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConditionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementRule" (
    "id" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "conditionId" TEXT,
    "ruleType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "gapHours" DOUBLE PRECISION,
    "conflictsWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "caloriesTarget" DOUBLE PRECISION NOT NULL,
    "proteinTarget" DOUBLE PRECISION NOT NULL,
    "carbsTarget" DOUBLE PRECISION,
    "fatTarget" DOUBLE PRECISION,
    "foods" JSONB NOT NULL,
    "reasoning" TEXT,
    "safetyScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MealRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationViolation" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "attribute" TEXT NOT NULL,
    "conditionName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationViolation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "checkType" TEXT NOT NULL,
    "input" JSONB,
    "result" JSONB,
    "safetyScore" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplementSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "timeOfDay" TEXT,
    "reminderTime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplementSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCoachingMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeSlot" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCoachingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientAttribute_attribute_idx" ON "IngredientAttribute"("attribute");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientAttribute_ingredientId_attribute_key" ON "IngredientAttribute"("ingredientId", "attribute");

-- CreateIndex
CREATE INDEX "SupplementAttribute_attribute_idx" ON "SupplementAttribute"("attribute");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementAttribute_supplementId_attribute_key" ON "SupplementAttribute"("supplementId", "attribute");

-- CreateIndex
CREATE INDEX "ConditionRule_conditionId_idx" ON "ConditionRule"("conditionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionRule_conditionId_attribute_target_key" ON "ConditionRule"("conditionId", "attribute", "target");

-- CreateIndex
CREATE INDEX "MealRecommendation_userId_createdAt_idx" ON "MealRecommendation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationViolation_userId_createdAt_idx" ON "RecommendationViolation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SafetyAuditLog_userId_createdAt_idx" ON "SafetyAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplementSchedule_userId_idx" ON "SupplementSchedule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplementSchedule_userId_supplementId_key" ON "SupplementSchedule"("userId", "supplementId");

-- CreateIndex
CREATE INDEX "DailyCoachingMessage_userId_createdAt_idx" ON "DailyCoachingMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "IngredientAttribute" ADD CONSTRAINT "IngredientAttribute_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementAttribute" ADD CONSTRAINT "SupplementAttribute_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionRule" ADD CONSTRAINT "ConditionRule_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementRule" ADD CONSTRAINT "SupplementRule_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementRule" ADD CONSTRAINT "SupplementRule_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "HealthCondition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationViolation" ADD CONSTRAINT "RecommendationViolation_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "MealRecommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplementSchedule" ADD CONSTRAINT "SupplementSchedule_supplementId_fkey" FOREIGN KEY ("supplementId") REFERENCES "Supplement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
