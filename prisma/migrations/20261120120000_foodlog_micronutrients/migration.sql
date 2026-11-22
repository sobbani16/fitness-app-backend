-- Persistent micronutrient storage per logged food.
-- Additive and nullable: existing rows are unaffected; values use the
-- canonical keys in src/services/nutrientCatalog.js (e.g. {"sodiumMg": 400}).
ALTER TABLE "FoodLog" ADD COLUMN "micronutrients" JSONB;
