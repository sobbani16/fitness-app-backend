# NUTRITION_DATA_QUALITY — Sprint C audit summary

FoodLog carries calories/protein/carbs/fat/fiber; addedSugar/satFat/sodium are NOT stored → always `unverified` in impact output (unknown≠zero). Verified per-100g data comes via IngredientNutritionProfile (verifiedAt-gated); servings via IngredientServing (61 USDA-verified rows). Recipe nutrition: portionG/finishedYieldG now persisted. Known gaps: category→food mapping table absent (categoryId is caller-supplied); composite foods unlinked (~17 lines); nutrient breadth for D-series scenarios absent.
