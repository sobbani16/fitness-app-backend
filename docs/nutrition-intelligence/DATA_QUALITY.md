# DATA_QUALITY — local dev DB snapshot

**Updated 2026-11-21 (evening)** — post-migration, post-population, post-cleanup.
Original read-only audit snapshot preserved inline below with corrections marked †.

DB: `postgresql://localhost:5432/fitness_app` — dev/test data, seed-heavy. **Correction †:** the earlier audit mis-attributed `HealthCondition`/`Allergy`/`ConditionRule` counts (a column-mapping error in the console output); true pre-cleanup values were HealthCondition 71 / Allergy 50 / ConditionRule **80** (legacy rows created June–Nov 18, NOT zero as first reported).

## Post-cleanup row counts (verified via `scripts/audit-junk-data.js` + psql)

| Table | Count | Change |
|---|---|---|
| Ingredient | **478** (was 529) | −51 `ms*` residue, −1 impossible-kcal row |
| Allergy | **2** (was 50) | −48 `ms* chicken` residue → `peanut`, `Peanuts` (plural near-dup, open) |
| HealthCondition | **22** (was 71) | −49 `ms* Diabetes test` residue; canonical set incl. Pregnancy |
| Recipe | **305** (was 371) | −66 `ms*` residue |
| ConditionRule | ~15 | legacy supplement/ingredient DRAFTs that pre-date today + 3 imported clinical_ingredient DRAFTs (ms*-linked rules deleted with their conditions) |
| Nutrient / IngredientNutritionProfile / IngredientNutrient | **27 / 18 / 486** | populated this session (all USDA-verified) |
| RuleEvidence / HealthConditionNutrientRule | **12 / 14** (all DRAFT) | imported, unactivated |
| ScenarioDefinition | **120** | seeded, all `pending_review` |
| `FoodLog.micronutrients` | **exists** | migration applied — `nutrientStatus` no longer throws |
| `dummy-*` fdcId / `ms*` names / kcal>900 | **0 / 0 / 0** | cleaned + `seed-foods.js` scrubbed |

## Report-only findings (in `junk-data-report.json`, not auto-fixed)

- 12 normalizedName dup groups (`bread`×9, `chicken curry`×3, pad-thai family, broccoli/spinach/almonds/avocado/quinoa ×2)
- `Allergy` near-dup `peanut` vs `Peanuts` (plural variant — merge needs review, not regex)
- 2 zero-kcal ingredients
- **1,817 `@test.dev` users** — overwhelming majority of the 1,845-user table is test residue; deletion is a large-blast-radius operation requiring its own reviewed script (FK Restrict chains on FoodLog/MealPlan/etc.)

## Original audit findings (superseded rows struck)

| Check | Was | Now |
|---|---|---|
| `ms*` junk rows (was "mislabeled USDA glucose syrup") | 41 ingredients — actually **test-suite residue** (`ms<base36>` fixture prefixes from `mealSuggest.test.js` etc.), not seed provenance bugs | 0; suite now cleans up after itself |
| `dummy-*` fdcIds | 15 | 0 (nulled — fake provenance is worse than none) |
| kcal>900 | 1 (`BREAD (8600)`) | 0 (deleted — column non-nullable) |
| `micronutrients` column | absent | present |
| Nutrient/profiles/rules | 0 / 0 / 0 | 27 / 18 / 486 + 12 evidence + 14+3 DRAFT rules |

Unchanged audit findings: 84 null fibers, `bread` dup group (9 rows), 141 recipes without `finishedYieldG`, 113 without `portionG`, 19 without calories, 113 without `nutritionSource`, 278 without declared allergens, 228/229 logs without `ingredientId`, 11/229 with `nutritionSnapshot`, 52 MacroGoal, 0 DailyMacroScore rows, 47 draft supplement rules, 510/529 ingredients without verified profiles (349 no source match, 161 source unavailable, 1 manual review — broccoli raw FDC 170379 vs 747447).

## Recommended standing checks (to script)

1. Impossible values: calories>900, macros summing >100g/100g, negative values, macro-energy reconciliation ±25%.
2. Duplicates: normalizedName groups with distinct fdcIds; near-dup names (plural/case variants — `peanut`/`Peanuts` pattern).
3. Provenance: `source='usda'` without fdcId or sourceMetadata; `GENERIC_COMPOSITION` % by category.
4. Missingness dashboards per nutrient — reuse `nutrients/population.js:coverage()`.
5. Recipe integrity: yield present + positive, ingredient grams sum ≈ raw mass vs yield, allergen coverage.
6. Junk-row sentinel: regex `^ms[a-z0-9]{5,}\s` names (test-residue signature); `dummy-*` fdcIds. — now implemented in `scripts/audit-junk-data.js`.

## Row counts

| Table | Count | Table | Count |
|---|---|---|---|
| User | 1,845 | Recipe | 371 (47 SYSTEM / 258 RESEARCH_DRAFT / 66 REJECTED) |
| FoodLog | 229 (148 users; min 2026-06-19, max 2026-11-21) | RecipeIngredient | 1,836 (93 without `ingredientId` link) |
| Ingredient | 529 | IngredientCatalog | 312 (all `GENERIC_COMPOSITION`) |
| IngredientNutritionProfile | **0** | IngredientNutrient / Nutrient | **0 / 0** |
| IngredientServing | 1 | IngredientAttribute | 67 |
| BarcodeProduct / ScannedLabel | 0 / 0 | ProductCorrection | 0 |
| RuleEvidence / HealthConditionNutrientRule / ConditionRule | **0 / 0 / 0** | IngredientEvidenceProfile | 0 (lazy-seeded on first evidence call) |
| Supplement | 207 (33 published / 88 candidate / 85 review_only / 1 archived) | SupplementInteractionRule | 47 (all `approved=false`) |
| HealthCondition / Allergy | 80 / 65 | UserHealthCondition / UserAllergy | 49 / 115 |
| MacroGoal / DailyMacroScore / HealthScore | 52 / **0** / 7 | UserPlanningPreferences | 65 (all 65 have dietaryRestrictions) |
| FoodPreference | 67 | SafetyAuditLog / MealRecommendation / Recommendation | 0 / 0 / 0 |
| ScenarioDefinition | table absent (migration pending) | DailyScoreSnapshot/GoalHistory | tables absent |

## Ingredient table findings

| Check | Result | Action proposed |
|---|---|---|
| `fiberPer100g` NULL | 84 / 529 | acceptable (null ≠ 0) — report in coverage dashboard |
| `caloriesPer100g` = 0 | 2 | review — likely placeholders |
| `caloriesPer100g` > 900 | **1** | impossible value — flag for correction |
| `fdcId` LIKE `dummy-%` | 15 | seed placeholders — re-source or mark synthetic |
| `fdcId` NULL | 357 | mostly catalog-sourced; OK if catalog provenance covers |
| Junk `msmw[a-z0-9]+ glucose syrup` rows | **41**, all `source='usda'` | **mislabeled provenance** — cleanup (D7); same junk is hard-coded in `prisma/seed-foods.js:28-58` |
| Duplicate `normalizedName` groups | 12 (`bread`×10, pad thai family ×4, chicken curry×3, others ×2) | dedupe review — `bread`×10 looks like per-variant rows with collapsed normalization |
| Macro-energy sanity | not computed this session | add to validation script (protein*4+carbs*4+fat*9 vs calories tolerance) |

## Recipe table findings

| Check | Result | Note |
|---|---|---|
| `finishedYieldG` NULL | 141 / 371 | mass-balance impossible for these |
| `portionG` NULL | 113 / 371 | portion intelligence limited |
| `calories` NULL | 19 | search suggests `calories IS NOT NULL` in meal-suggest — 19 invisible there |
| `nutritionSource` NULL | 113 | no declared provenance |
| `allergens` = {} | 278 / 371 | allergy exclusion falls back to ingredient-name matching — weaker but deterministic; document as limitation |
| cuisine = Indian | 150 / 371 | aligns with India-first roadmap |
| `reviewStatus` | 258 RESEARCH_DRAFT, 66 REJECTED, 47 SYSTEM | RESEARCH_DRAFT visible in browse (`not: 'REJECTED'`) — labeled `ESTIMATED`, acceptable but surfaces need the label |
| RecipeIngredient unlinked | 93 / 1,836 | can't resolve to verified profiles |

## FoodLog findings

| Check | Result | Note |
|---|---|---|
| `ingredientId` NULL | 228 / 229 | nearly all logs unlinked — no verified-profile path for logged food |
| `nutritionSnapshot` present | 11 / 229 | provenance capture barely exercised |
| mealType distribution | breakfast 167, lunch 32, dinner 29, meal 1 | skewed — seed data likely |
| `micronutrients` column | **absent in DB** (migration `20261120120000` pending) | `nutrientStatus` selects it → **runtime failure on this DB** |

## Supplements (for completeness — separate engine)

- 207 catalog rows with catalogStatus lifecycle; 47 interaction rules all `approved=false` (per AGENTS.md — correct by design).
- `SupplementLog`/`SupplementDoseOccurrence` feed `supplementsLogged` count in nutrientStatus — correctly kept out of food totals.

## Recommended standing checks (to script)

1. Impossible values: calories>900, macros summing >100g/100g (except water-free powders), negative values, macro-energy reconciliation ±25%.
2. Duplicates: normalizedName groups with distinct fdcIds; near-dup names.
3. Provenance: `source='usda'` without fdcId or sourceMetadata; `GENERIC_COMPOSITION` % by category.
4. Missingness dashboards per nutrient (once populated) — reuse `nutrients/population.js:coverage()`.
5. Recipe integrity: yield present + positive, ingredient grams sum ≈ raw mass vs yield, allergen coverage.
6. Junk-row sentinel: regex `^msmw[a-z0-9]+ ` names; `dummy-*` fdcIds in non-seed sources.
