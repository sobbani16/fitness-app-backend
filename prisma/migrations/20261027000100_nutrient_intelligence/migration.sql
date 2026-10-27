-- Additive only: existing ingredient IDs, preparation rows and macro values are untouched.
CREATE TYPE "NutrientCategory" AS ENUM ('MACRO', 'MINERAL', 'VITAMIN', 'OTHER');
CREATE TYPE "NutritionPreparation" AS ENUM ('RAW', 'BOILED', 'STEAMED', 'FRIED', 'ROASTED', 'OTHER');
CREATE TYPE "NutritionSource" AS ENUM ('USDA', 'IFCT', 'MANUAL', 'OTHER');
CREATE TABLE "Nutrient" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "unit" TEXT NOT NULL,
  "category" "NutrientCategory" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Nutrient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Nutrient_name_key" ON "Nutrient"("name");
CREATE UNIQUE INDEX "Nutrient_code_key" ON "Nutrient"("code");
CREATE TABLE "IngredientNutritionProfile" (
  "id" UUID NOT NULL, "ingredientId" TEXT NOT NULL,
  "preparationType" "NutritionPreparation" NOT NULL, "preparationMethod" TEXT,
  "source" "NutritionSource" NOT NULL, "sourceFoodId" TEXT,
  "sourceDataset" TEXT NOT NULL, "sourceRecordKey" TEXT NOT NULL, "sourceCitation" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IngredientNutritionProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IngredientNutritionProfile_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IngredientNutritionProfile_identityKey_key" ON "IngredientNutritionProfile"("identityKey");
CREATE INDEX "IngredientNutritionProfile_ingredientId_preparationType_idx" ON "IngredientNutritionProfile"("ingredientId", "preparationType");
CREATE INDEX "IngredientNutritionProfile_source_sourceFoodId_idx" ON "IngredientNutritionProfile"("source", "sourceFoodId");
CREATE TABLE "IngredientNutrient" (
  "id" UUID NOT NULL, "nutritionProfileId" UUID NOT NULL, "nutrientId" UUID NOT NULL,
  "amountPer100g" DECIMAL(18,9),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IngredientNutrient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IngredientNutrient_amount_check" CHECK ("amountPer100g" IS NULL OR ("amountPer100g" >= 0 AND "amountPer100g" < 1000000000)),
  CONSTRAINT "IngredientNutrient_nutritionProfileId_fkey" FOREIGN KEY ("nutritionProfileId") REFERENCES "IngredientNutritionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IngredientNutrient_nutrientId_fkey" FOREIGN KEY ("nutrientId") REFERENCES "Nutrient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IngredientNutrient_nutritionProfileId_nutrientId_key" ON "IngredientNutrient"("nutritionProfileId", "nutrientId");
CREATE INDEX "IngredientNutrient_nutrientId_idx" ON "IngredientNutrient"("nutrientId");
