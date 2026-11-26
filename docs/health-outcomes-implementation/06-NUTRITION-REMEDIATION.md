# 06 — Nutrition Remediation

**Status:** ENGINEERING_COMPLETE (drift reproduced + repaired; enrichment pipeline documented)

## F-R1 — conditions dropped (FIXED)
`generateMealRecommendation` passed `conditions`; `generateFoodSuggestions` ignored them. Now resolved via `liveRuleWhere`-gated rules; provenance in `eligibility.conditionBlocksApplied`. Test: DRAFT doesn't exclude, live block does.

## Recipe drift (reproduced + repaired)
`scripts/recipe-nutrition-audit.js` recomputes every SYSTEM recipe from resolved ingredient lines:
- **Before:** 16/258 drifted >5% on ≥1 macro (audit found 15/28 in its sample — same population)
- Root cause: stored totals came from generic estimates (`RECIPE_CALCULATED_FROM_UNVERIFIED_GENERIC_INGREDIENT_ESTIMATES`); recompute from linked per-100g lines is authoritative
- **After `--apply`:** 16 repaired, 0 residual drift on fully-resolved recipes; `nutritionSource` records prior values (reversible)
- 12 recipes skipped — unresolved `ingredientId` lines (undercount risk); 2 without yield/servings scale. BLOCKED on ingredient linking (data enrichment, not engineering)

## Ingredient attributes
- Salmon `HIGH_MERCURY` removed (dev DB + `seed-safety.js`) — FDA "Best Choices" low-mercury; the pregnancy block rule still exists for genuinely high-mercury fish

## Remaining
- Micronutrient coverage ~4.2%: remediation needs licensed source (USDA FDC API) + human-review queue — framework documented, backfill NOT fabricated
- Unknown-nutrient semantics preserved throughout (null ≠ 0)
