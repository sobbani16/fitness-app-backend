# 04 — Nutrition Database Audit

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
**Access:** `postgresql://localhost:5432/fitness_app` — dev database, READ-ONLY queries. This is a development fixture dataset (~2,427/2,491 users are test accounts), NOT production. Production data quality cannot be certified from this audit — treat results as "schema+seed behavior verified on dev"; re-run queries on a sanitized prod snapshot before release sign-off.

## 1. Table inventory (nutrition-relevant)

| Table | Rows | Notes |
|---|---|---|
| Ingredient | 426 | 186 w/ USDA fdcId; 228 humai-catalog; 10 seed; **10 test-fixture** (9 named "BREAD") |
| IngredientCatalog | 228 | all `GENERIC_COMPOSITION`, `usable=true`, `reviewRequired` unset |
| IngredientServing | 422 | covers only **190/426 (44.6%)** of ingredients |
| IngredientNutritionProfile | 18 | **only 18 ingredients have full micronutrient profiles** |
| IngredientNutrient | 486 | 18 profiles × 27 nutrients |
| Nutrient | 27 | macros+minerals+vitamins incl. sodium, potassium, phosphorus, sat fat, added sugar |
| IngredientAttribute | 23 | only ~21 ingredients classified; **zero sodium/potassium/phosphorus attributes exist** |
| Recipe | 258 | 28 SYSTEM + 230 RESEARCH_DRAFT; 122 Indian cuisine |
| RecipeIngredient | 1,714 | 17 lines lack ingredientId (all in SYSTEM recipes); 0 orphans |
| FoodLog | 323 | macros non-nullable (0=unknown problem mitigated by `nutrientUnknowns` in snapshot) |
| HealthCondition | 23 | 5 allergy rows + Pregnancy inside condition table |
| ConditionRule | 34 | **all DRAFT**; attribute-based block/warn |
| HealthConditionNutrientRule | 14 | **all DRAFT**; evidence-linked |
| RuleEvidence | 21 | **9 are test fixtures** ("Test Fixture / Fixture guideline") |
| UserHealthCondition | 1 | only fixture-created |
| UserAllergy | 76 | real usage |
| Supplement* | 207 + aliases/forms/ingredients | catalog v1 imported; 47 interaction rules all unapproved |

## 2. Critical data-quality findings

### F-N1 — Micronutrient coverage: 4.2% of ingredients (HIGH)
Only 18 `IngredientNutritionProfile` rows exist → sodium, potassium, phosphorus, saturated fat, total/added sugar are **unknown for ~96% of ingredients**. Consequences:
- Hypertension `HIGH_SODIUM`, CKD `HIGH_POTASSIUM`/`HIGH_PHOSPHORUS` rules cannot evaluate 408/426 ingredients — even if approved, they can't fire.
- No condition-relevant nutrient scoring is possible on most of the catalog.
- Recipe-level sodium/sugar reporting is impossible.

### F-N2 — Condition rules 100% DRAFT (HIGH)
34/34 ConditionRule and 14/14 HealthConditionNutrientRule are `DRAFT`. Every consumer (`ingredientValidator`, `constraints.js`, `weeklyDietGenerator`, `mealSuggestion`, `conditionEvaluation`, supplement engine) filters `reviewStatus='APPROVED'` → **condition-aware filtering is inert end-to-end**. Correct conservative posture; zero clinical value today.

### F-N3 — SYSTEM recipe stored nutrition is stale (HIGH)
Recomputing per-serving kcal from ingredient lines vs stored `Recipe.calories`:
- SYSTEM (28 recipes): **15/28 differ >20%** (avg |Δ| 111 kcal); 17 ingredient lines unresolved (NULL ingredientId).
- RESEARCH_DRAFT (230): 0 mismatches — stored values were computed from lines at import.
Root cause: SYSTEM seeds predate per-100g normalization; values were hand-authored. These are the recipes most likely shown first (`isSystem=true`).

### F-N4 — IngredientAttribute misclassifications (MEDIUM-HIGH)
23 rows total. Of the classified set, errors found:
- `Salmon, Atlantic: HIGH_MERCURY` — wrong direction; FDA/EPA classify salmon as a **low-mercury "Best Choice"** fish. Combined with the Pregnancy `HIGH_MERCURY → block` rule this would block a recommended fish in pregnancy.
- `Oats: CONTAINS_GLUTEN` — oats are naturally gluten-free; celiac guidance allows pure oats (cross-contact caveat). Attribute model cannot express "certification-dependent".
- `Banana: HIGH_GLYCEMIC + HIGH_SUGAR`, `Sweet potato: HIGH_GLYCEMIC` — blanket GI labeling without ripeness/preparation context; drives the T2D `HIGH_SUGAR → block` over-blocking.
- 12 distinct attributes total; no HIGH_SODIUM/HIGH_POTASSIUM/HIGH_PHOSPHORUS/PURINE attributes exist despite rules referencing them (CKD/Gout rules reference attributes with **zero** ingredient coverage → can never fire).

### F-N5 — Test-fixture pollution in reference tables (MEDIUM)
- `Ingredient` 10 rows `source='test-fixture'` (9× "BREAD", "Humai Test Rice") — visible to all searches; explains part of 23 duplicate normalized names.
- `RuleEvidence` 9/21 rows are `Test Fixture` org with fake guideline titles — pollutes the clinical evidence registry; must be excluded from any evidence audit/report.

### F-N6 — Serving coverage 44.6% (MEDIUM)
422 servings across 190 ingredients; all rows `estimated=false`. 236 ingredients have no serving → gram-only UX or silent fallback; check import provenance for the `estimated=false` marking (USDA-derived portions likely).

### F-N7 — Macro-derived calorie consistency: PASS w/ exceptions
4-4-9 reconciliation: 383 ≤30 kcal, 23 in 31–80, 20 >80. The >80 set is explainable (spices — fiber-heavy carbs by difference; glucose tablets — polyol energy; wine — alcohol). No systemic corruption, no float artifacts observed (Decimal used for nutrients).

### F-N8 — HealthCondition table mixes classes (MEDIUM)
23 rows include 5 food **allergies** (Dairy/Egg/Nut/Shellfish/Soy) + Pregnancy alongside diseases → risks double-classification with the `Allergy`/`UserAllergy` system (which is the working allergy path). Allergy-as-condition rules duplicate allergen logic with weaker matching.

### F-N9 — Nutrient value sanity (PASS)
Spot-checked: no negative amounts; Decimal(18,9) prevents float corruption; profile `verifiedAt` gates evaluation (all 18 profiles verified per earlier check); provenance fields populated (`sourceDataset`, `sourceRecordKey`, `sourceCitation`).

### F-N10 — Duplicate ingredients (LOW-MEDIUM)
403 distinct normalized names vs 426 rows: 23 dups — mostly BREAD test fixtures + GLUCOSE TABLETS ×6 (real USDA dups with distinct ids).

## 3. Ingredient-condition suitability map (as data currently supports)

| Condition | Suitability mechanism available? | Usable today? |
|---|---|---|
| Celiac | CONTAINS_GLUTEN attr (1 ingredient) + gluten_free restriction terms | Partial — text-term path works; attribute coverage ~nil |
| T2D/Prediabetes | HIGH_SUGAR/HIGH_GLYCEMIC attrs (4 ingredients) + carb math | No — blanket block on fruit-class items; no portion context |
| Hypertension | HIGH_SODIUM attr (0 ingredients), no sodium values | **No** |
| CKD | HIGH_POTASSIUM/HIGH_PHOSPHORUS attrs (0), no mineral values | **No** |
| Gout | HIGH_PURINE/HFCS attrs (0) | **No** |
| GERD | ACIDIC/SPICY/HIGH_FAT attrs (2 total) | Effectively no |
| Allergies | Canonical keyword sets + declared recipe allergens | **Yes** (best-covered path) |

## 4. What is structurally missing for the 40-condition goal

1. User-facing condition write path (API + mobile UI + consent).
2. Per-100g micronutrient population beyond 18 ingredients (USDA FDC SR Legacy/Foundation coverage needed for the ~400 catalog items).
3. Portion-aware (not binary) suitability model + disease-stage axis (CKD stages, compensated vs decompensated cirrhosis).
4. Medication model (insulin/sulfonylurea hypoglycemia risk, warfarin–vitamin K, levothyroxine–calcium/iron timing, metformin–B12).
5. Sodium/sugar/sat-fat fields or profile-driven totals on Recipe + roll-up to weekly plans.
6. Purine/GI/lactose/oxalate/FODMAP/histamine attribute taxonomies with sourced assignments.
7. Test-fixture hygiene in Ingredient/RuleEvidence (env-scoped cleanup or `synthetic` flag like HealthMeasurement uses).
