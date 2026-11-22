-- Smart Kitchen: recipe instructions, optional ingredient lines, grocery list, engagement
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "prepMinutes" INTEGER;
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "instructions" JSONB;
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "safetyNotes" JSONB;
ALTER TABLE "RecipeIngredient" ADD COLUMN IF NOT EXISTS "optional" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "GroceryItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "amountG" DOUBLE PRECISION,
  "unitLabel" TEXT,
  "optional" BOOLEAN NOT NULL DEFAULT false,
  "sourceRecipeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroceryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GroceryItem_userId_status_idx" ON "GroceryItem"("userId", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GroceryItem_userId_fkey'
  ) THEN
    ALTER TABLE "GroceryItem"
      ADD CONSTRAINT "GroceryItem_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "RecipeEngagement" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipeId" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "rating" INTEGER,
  "notes" TEXT,
  "customData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecipeEngagement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeEngagement_userId_recipeId_key" ON "RecipeEngagement"("userId", "recipeId");
CREATE INDEX IF NOT EXISTS "RecipeEngagement_userId_favorite_idx" ON "RecipeEngagement"("userId", "favorite");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RecipeEngagement_userId_fkey'
  ) THEN
    ALTER TABLE "RecipeEngagement"
      ADD CONSTRAINT "RecipeEngagement_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RecipeEngagement_recipeId_fkey'
  ) THEN
    ALTER TABLE "RecipeEngagement"
      ADD CONSTRAINT "RecipeEngagement_recipeId_fkey"
      FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "allergens" TEXT[] NOT NULL DEFAULT '{}';
