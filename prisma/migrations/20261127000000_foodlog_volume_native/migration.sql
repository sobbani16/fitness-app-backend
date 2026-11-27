-- HUM-49 volume-native persistence (decisions #111/#144/#155).
-- Backward-compatible: quantityG becomes nullable (null = unknown mass — never
-- fabricated); historical rows keep their measured mass untouched. Volume-native
-- columns are additive. No data migration, no rewrites.
ALTER TABLE "FoodLog" ALTER COLUMN "quantityG" DROP NOT NULL;
ALTER TABLE "FoodLog" ADD COLUMN "quantityMl" DOUBLE PRECISION;
ALTER TABLE "FoodLog" ADD COLUMN "quantityUnit" TEXT;
