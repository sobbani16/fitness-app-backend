-- Additive only: density + volume support for serving resolution (HUM-49).
-- Nullable columns preserve existing rows, old clients, and historical snapshots.
ALTER TABLE "Ingredient" ADD COLUMN "densityGPerMl" DOUBLE PRECISION;
ALTER TABLE "IngredientServing" ADD COLUMN "ml" DOUBLE PRECISION;
