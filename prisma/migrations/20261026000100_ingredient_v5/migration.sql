DROP INDEX "IngredientCatalog_normalizedName_key";
ALTER TABLE "IngredientCatalog" ADD COLUMN "verificationLevel" TEXT, ADD COLUMN "brand" TEXT, ADD COLUMN "restaurantChain" TEXT, ADD COLUMN "market" TEXT, ADD COLUMN "foodType" TEXT, ADD COLUMN "cuisine" TEXT, ADD COLUMN "identityKey" TEXT, ADD COLUMN "importBatch" TEXT, ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ingredient" ADD COLUMN "sourceMetadata" JSONB;
ALTER TABLE "UserIngredient" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "selectedAt" TIMESTAMP(3);
ALTER TABLE "FoodLog" ADD COLUMN "ingredientId" TEXT, ADD COLUMN "nutritionSnapshot" JSONB;
ALTER TABLE "RecipeIngredient" ADD COLUMN "ingredientId" TEXT, ADD COLUMN "nutritionSnapshot" JSONB;
CREATE TABLE "IngredientServing" ("id" TEXT PRIMARY KEY, "ingredientId" TEXT NOT NULL REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE, "label" TEXT NOT NULL, "grams" DOUBLE PRECISION NOT NULL, "estimated" BOOLEAN NOT NULL DEFAULT true, "sourceRecord" JSONB NOT NULL);
CREATE INDEX "IngredientServing_ingredientId_idx" ON "IngredientServing"("ingredientId");
CREATE TABLE "IngredientImport" ("id" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "filename" TEXT NOT NULL, "report" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
