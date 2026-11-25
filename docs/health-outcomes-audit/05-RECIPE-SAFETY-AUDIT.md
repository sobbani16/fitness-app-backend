# 05 — Recipe Intelligence & Safety Audit

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. Architecture assessed

| Component | File | Verdict |
|---|---|---|
| User constraint engine | `services/recipes/constraints.js` | STRONG — server-authoritative; request params narrow-only; allergies/conditions/preferences/equipment merged; unknowns recorded not assumed-safe; APPROVED-rules only |
| Hard-violation checker | `violatesHard` | Correct precedence: allergen text → declared allergens → exclusions → categories → tags → attributes |
| AI generation | `recipes/generate.js` | STRONG — candidates-only, injection hygiene (control-char strip, length caps), "impossible → empty + explain", one constrained correction attempt, falls back to VERIFIED match or `NO_ELIGIBLE_RECIPE` |
| Deterministic validator | `recipes/validate.js` | STRONG — PASS/NEEDS_CLARIFICATION/NEEDS_REVIEW/FAIL; food-safety rules (poultry ≥165°F, raw egg, raw flour, leftover rice/B. cereus, raw shellfish); revalidation-on-change contract |
| Meal suggestion | `mealSuggestion.js` | Sound — allergen keyword expansion, NEVER_RECOMMEND, APPROVED rules; explicit disclaimer "not a clinical guarantee" |
| Weekly diet generator | `weekly/weeklyDietGenerator.js` | Merges allergies + conditionRules + nutrientRules (APPROVED only); AI path flagged; honest limitation strings |
| Meal recommendation (legacy) | `safety/mealRecommendationService.js` | **GAP** — `generateFoodSuggestions({mealType, caloriesTarget, allergies})` does NOT destructure `conditions` — health conditions passed in are silently ignored; only allergies filter |

## 2. Recipe nutrition correctness

| Check | Result |
|---|---|
| Per-100g math | Correct — `computeFromLines`/`computeMealNutrition` scale amounts/100 |
| Servings handling | `Recipe.calories` = per-serving; `RecipeIngredient.amountG` = batch. Consistent for all 230 RESEARCH_DRAFT (0 mismatches). **15/28 SYSTEM recipes disagree >20%** (stale hand-authored values; avg Δ111 kcal) — F-N3 |
| Cooked yield | `finishedYieldG` on 230 recipes — present but unverified provenance (imported, RESEARCH_DRAFT status is honest) |
| Unresolved lines | 17 RecipeIngredient rows (SYSTEM recipes) lack `ingredientId` → recomputed values are undercounts there |
| Missing nutrients | Recipe model has NO sodium/sugar/sat-fiber columns → condition-relevant recipe scoring impossible |
| Oils/sauces/condiments | COMPOUND_HINT flags unresolved compound names → review finding (never silent) |
| Substitution path | AI substitutions captured in schema; deterministic re-validation required after transform |

## 3. Disease-aware recommendation coverage (today's executable behavior)

| Test | Result |
|---|---|
| Diabetes + CKD recipe | No DRAFT rule fires; no nutrient limits; only allergen/pattern filters apply → **unsafe-by-omission** (recommendation proceeds without K⁺/PO₄/sodium checks) |
| MASLD + hypertriglyceridemia | Conditions don't exist in DB → nothing |
| Celiac + diabetes | gluten_free restriction works via text/terms; T2D block inert |
| Pregnancy + GDM | Pregnancy not a user-settable condition; HIGH_MERCURY rule DRAFT; salmon misattributed anyway |
| No safe recipe case | `NO_ELIGIBLE_RECIPE` honest failure path exists — PASS |
| Unknown restriction | Recorded as `unverifiable`, literal-match only, never silently ignored — PASS |
| Indian pattern coverage | 122/258 recipes Indian cuisine — strongest coverage; dal/paneer/soy/roti/rice present; veg/eggetarian/nonveg restrictions mapped in `RESTRICTIONS` |

## 4. Findings

| ID | Sev | Finding |
|---|---|---|
| F-R1 | HIGH | `mealRecommendationService.generateFoodSuggestions` ignores `conditions` — recommendations for a T2D+CKD user apply zero condition logic |
| F-R2 | HIGH | Condition-aware recipe safety is structurally present but universally inert (DRAFT rules + no user conditions + no micronutrient data) |
| F-R3 | MEDIUM | Recipe model cannot represent sodium/potassium/phosphorus/sugar → cannot evaluate the nutrient rules the schema already supports |
| F-R4 | LOW | `nutritionValidator` `safe` flag tolerates up to 1 `*_excess` warning — weak guard, warnings-only path |
| F-R5 | LOW | SYSTEM recipes' stale nutrition is the surface users hit first (isSystem=true) |

## 5. What must be true before disease-aware recipes ship

1. Condition write path + APPROVED rules + micronutrient coverage (F-N1/F-N2).
2. Recipe nutrient roll-up for sodium/sugar/sat fat via IngredientNutritionProfile.
3. Portion-context rules (per-serving thresholds — `HealthConditionNutrientRule` already models `thresholdBasis=PER_SERVING`).
4. Fix `generateFoodSuggestions` conditions gap or deprecate legacy path in favor of `constraints.js`.
5. Re-seed SYSTEM recipe nutrition from ingredient lines.
