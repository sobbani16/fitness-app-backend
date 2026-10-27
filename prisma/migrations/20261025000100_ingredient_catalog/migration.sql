CREATE TABLE "IngredientCatalog" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "normalizedName" TEXT NOT NULL,
 "aliases" TEXT[] NOT NULL, "category" TEXT NOT NULL, "preparation" TEXT NOT NULL,
 "status" TEXT NOT NULL, "usable" BOOLEAN NOT NULL, "sourceRecord" JSONB NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "IngredientCatalog_normalizedName_key" ON "IngredientCatalog"("normalizedName");
CREATE INDEX "IngredientCatalog_usable_normalizedName_idx" ON "IngredientCatalog"("usable", "normalizedName");
ALTER TABLE "Ingredient" ALTER COLUMN "fdcId" DROP NOT NULL;
ALTER TABLE "Ingredient" ADD COLUMN "catalogId" TEXT, ADD COLUMN "fiberPer100g" DOUBLE PRECISION;
CREATE UNIQUE INDEX "Ingredient_catalogId_key" ON "Ingredient"("catalogId");
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "IngredientCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
