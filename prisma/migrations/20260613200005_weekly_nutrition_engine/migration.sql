-- CreateTable
CREATE TABLE "UserPlanningPreferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planGenerationDay" TEXT NOT NULL DEFAULT 'sunday',
    "planGenerationTime" TEXT NOT NULL DEFAULT '06:00',
    "mealPrepStyle" TEXT NOT NULL DEFAULT 'daily_cooking',
    "shoppingDay" TEXT,
    "shoppingTime" TEXT,
    "budgetLevel" TEXT NOT NULL DEFAULT 'medium',
    "cookingSkill" TEXT NOT NULL DEFAULT 'intermediate',
    "householdSize" INTEGER NOT NULL DEFAULT 1,
    "availableEquipment" TEXT[],
    "dietaryRestrictions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPlanningPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "preference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FoodPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyNutritionPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "caloriesTarget" DOUBLE PRECISION NOT NULL,
    "proteinTarget" DOUBLE PRECISION NOT NULL,
    "carbsTarget" DOUBLE PRECISION NOT NULL,
    "fatTarget" DOUBLE PRECISION NOT NULL,
    "fiberTarget" DOUBLE PRECISION NOT NULL,
    "waterMlTarget" INTEGER NOT NULL DEFAULT 2000,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyNutritionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyMeal" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "mealType" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "portionG" DOUBLE PRECISION NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbsG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "fiberG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ingredientId" TEXT,
    "prepNote" TEXT,

    CONSTRAINT "WeeklyMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyShoppingList" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyShoppingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyShoppingItem" (
    "id" TEXT NOT NULL,
    "shoppingListId" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "quantityG" DOUBLE PRECISION NOT NULL,
    "quantityDisplay" TEXT NOT NULL,
    "category" TEXT,
    "inInventory" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WeeklyShoppingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodInventory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodName" TEXT NOT NULL,
    "ingredientId" TEXT,
    "quantityG" DOUBLE PRECISION NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietAdherenceScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "adherencePercent" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "caloriesTarget" DOUBLE PRECISION NOT NULL,
    "caloriesActual" DOUBLE PRECISION NOT NULL,
    "proteinTarget" DOUBLE PRECISION NOT NULL,
    "proteinActual" DOUBLE PRECISION NOT NULL,
    "mealsPlanned" INTEGER NOT NULL DEFAULT 0,
    "mealsLogged" INTEGER NOT NULL DEFAULT 0,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DietAdherenceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalorieAdjustmentHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "previousCalories" DOUBLE PRECISION NOT NULL,
    "newCalories" DOUBLE PRECISION NOT NULL,
    "adjustmentAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "adherencePercent" DOUBLE PRECISION,
    "weightTrendKg" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalorieAdjustmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReview" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStartDate" TEXT NOT NULL,
    "weightStart" DOUBLE PRECISION,
    "weightEnd" DOUBLE PRECISION,
    "caloriesAvg" DOUBLE PRECISION,
    "proteinAvg" DOUBLE PRECISION,
    "healthScoreAvg" DOUBLE PRECISION,
    "compliancePercent" DOUBLE PRECISION,
    "adherencePercent" DOUBLE PRECISION,
    "overallResult" TEXT,
    "recommendation" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyRecommendation" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPlanningPreferences_userId_key" ON "UserPlanningPreferences"("userId");

-- CreateIndex
CREATE INDEX "FoodPreference_userId_idx" ON "FoodPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodPreference_userId_foodName_key" ON "FoodPreference"("userId", "foodName");

-- CreateIndex
CREATE INDEX "WeeklyNutritionPlan_userId_weekStartDate_idx" ON "WeeklyNutritionPlan"("userId", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyNutritionPlan_userId_weekStartDate_key" ON "WeeklyNutritionPlan"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyMeal_planId_dayOfWeek_idx" ON "WeeklyMeal"("planId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyShoppingList_planId_key" ON "WeeklyShoppingList"("planId");

-- CreateIndex
CREATE INDEX "WeeklyShoppingItem_shoppingListId_idx" ON "WeeklyShoppingItem"("shoppingListId");

-- CreateIndex
CREATE INDEX "FoodInventory_userId_idx" ON "FoodInventory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FoodInventory_userId_foodName_key" ON "FoodInventory"("userId", "foodName");

-- CreateIndex
CREATE INDEX "DietAdherenceScore_userId_idx" ON "DietAdherenceScore"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DietAdherenceScore_userId_weekStartDate_key" ON "DietAdherenceScore"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "CalorieAdjustmentHistory_userId_weekStartDate_idx" ON "CalorieAdjustmentHistory"("userId", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReview_planId_key" ON "WeeklyReview"("planId");

-- CreateIndex
CREATE INDEX "WeeklyReview_userId_weekStartDate_idx" ON "WeeklyReview"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyRecommendation_reviewId_idx" ON "WeeklyRecommendation"("reviewId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "WeeklyMeal" ADD CONSTRAINT "WeeklyMeal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeeklyNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyShoppingList" ADD CONSTRAINT "WeeklyShoppingList_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeeklyNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyShoppingItem" ADD CONSTRAINT "WeeklyShoppingItem_shoppingListId_fkey" FOREIGN KEY ("shoppingListId") REFERENCES "WeeklyShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeeklyNutritionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyRecommendation" ADD CONSTRAINT "WeeklyRecommendation_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "WeeklyReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
