/*
  Warnings:

  - A unique constraint covering the columns `[recipeName]` on the table `Recipe` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Recipe" ADD COLUMN     "calories" DOUBLE PRECISION,
ADD COLUMN     "carbsG" DOUBLE PRECISION,
ADD COLUMN     "fatG" DOUBLE PRECISION,
ADD COLUMN     "fiberG" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mealType" TEXT,
ADD COLUMN     "portionG" DOUBLE PRECISION,
ADD COLUMN     "proteinG" DOUBLE PRECISION,
ALTER COLUMN "servings" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "WeeklyMeal" ADD COLUMN     "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "recipeId" TEXT;

-- AlterTable
ALTER TABLE "WeeklyShoppingItem" ADD COLUMN     "checked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_recipeName_key" ON "Recipe"("recipeName");

-- CreateIndex
CREATE INDEX "RecipeIngredient_recipeId_idx" ON "RecipeIngredient"("recipeId");

-- CreateIndex
CREATE INDEX "WeeklyMeal_recipeId_idx" ON "WeeklyMeal"("recipeId");

-- AddForeignKey
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyMeal" ADD CONSTRAINT "WeeklyMeal_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
