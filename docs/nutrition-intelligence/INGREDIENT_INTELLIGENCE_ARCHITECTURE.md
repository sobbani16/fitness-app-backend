# INGREDIENT_INTELLIGENCE_ARCHITECTURE (Sprint C)

`src/services/ingredientImpact.js` — deterministic, pure: `CATEGORIES` taxonomy, `evaluatePortion`, `suggestSubstitutions`. **Consumer (wired):** `POST /food-logs/intelligence` — response gains `impact` + `substitutions` computed from the SAME verified per-100g profile nutrients (extraction: per100 × grams/100; missing → `INCOMPLETE_DATA`). Goal from `User.goalType` (canonical), targets from `MacroGoal`, allergen terms from `UserAllergy` — all server-loaded; client input never supplies them.

Pattern layer lives in `trends.js` `observations[]` (`frequent_calorie_dense`: ≥3 logs AND ≥15% avg share). Extension point: `categoryId` param scopes education; medical-condition categories slot behind `condition_rules` flag (not wired — no unapproved advice).
