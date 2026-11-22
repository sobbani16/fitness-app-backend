# CLINICAL_RULE_REVIEW_QUEUE — DRAFT inventory + review package

**Generated:** 2026-11-21 · gating verified by `node scripts/verify-rule-gating.js` (ok:true, 0 unapproved rules visible to any consumer) · **Nothing auto-approved** — all rows below remain `DRAFT` and inert.

## Uniform gating contract (VERIFIED)

Every `ConditionRule` consumer filters `reviewStatus: 'APPROVED'` at the query level: `mealSuggestion.js`, `healthScoreEngine.js`, `safety/ingredientValidator.js`, `safety/supplementValidator.js`, `weekly/weeklyDietGenerator.js` (precedent: `nutritionRecommendation.js`). `HealthConditionNutrientRule` consumers go through `conditionEvaluation.evaluate`, which refuses non-APPROVED. DB CHECK constraint `ConditionRule_check` additionally requires `reviewedBy`, `reviewedAt`, `evidenceSourceId`, `clinicalAction` on every APPROVED row — an approval cannot be written silently.

## Queue A — HealthConditionNutrientRule (14 rows, evidence present, thresholds NULL)

All imported this session from `data/imports/` seed; each carries a real guideline citation but **no numeric threshold** — they cannot be approved until a clinician supplies the limit.

| # | Condition | Nutrient | Evidence org | Missing |
|---|---|---|---|---|
| 1 | Type 1 Diabetes | SUGAR_ADDED | ADA | threshold, units, direction |
| 2 | Type 1 Diabetes | CARBOHYDRATE_TOTAL | NIH/NIDDK | threshold |
| 3 | Type 2 Diabetes | SUGAR_ADDED | ADA | threshold |
| 4 | Type 2 Diabetes | CARBOHYDRATE_TOTAL | NIH/NIDDK | threshold |
| 5 | Prediabetes | SUGAR_ADDED | ADA | threshold |
| 6 | Hypertension | SODIUM | AHA | threshold (guideline ~1500–2300 mg/d — reviewer must pick) |
| 7 | CKD | POTASSIUM | NIH/NIDDK | threshold + stage applicability |
| 8 | CKD | PHOSPHORUS | NIH/NIDDK | threshold + stage applicability |
| 9 | High LDL Cholesterol | FAT_SATURATED | AHA | threshold |
| 10 | Hypertriglyceridemia | SUGAR_ADDED | AHA/ACC | threshold |
| 11 | Hypertriglyceridemia | FAT_SATURATED | AHA/ACC | threshold |
| 12 | Iron Deficiency | IRON | NIH ODS | threshold (this is a *minimum*, direction differs) |
| 13 | Hypothyroidism | IODINE | ATA | threshold |
| 14 | Hyperthyroidism | IODINE | ATA | threshold |

## Queue B — ConditionRule clinical_ingredient (3 rows, evidence present)

| # | Attribute | Evidence | Missing |
|---|---|---|---|
| 1 | CONTAINS_GLUTEN | NIH/NIDDK (celiac) | `clinicalAction` text, target condition |
| 2 | CONTAINS_HIGH_FRUCTOSE_CORN_SYRUP | ACR (gout) | `clinicalAction`, applicability scope |
| 3 | CONTAINS_LACTOSE | NIH/NIDDK | `clinicalAction`, intolerance vs allergy scope |

## Queue C — legacy ConditionRule DRAFTs (31 rows, NO evidence)

Attribute flags (GLUTEN, DAIRY, EGG, NUT, SHELLFISH, SOY, HIGH_SODIUM, HIGH_SUGAR, HIGH_MERCURY, HIGH_POTASSIUM, HIGH_PHOSPHORUS, HIGH_PURINE, HIGH_GLYCEMIC, ACIDIC, GOITROGENIC, IODINE, SPICY, HIGH_FAT; supplement cautions incl. PREGNANCY_CAUTION, THYROID_CAUTION, DIABETES_CAUTION, 3× CONTAINS_CAFFEINE). **No `RuleEvidence` attached** — they were live-and-firing before the gating fix. Options for reviewer: attach evidence + thresholds, or archive. Duplicates exist (2× HIGH_GLYCEMIC warn, 2× HIGH_SUGAR block, 2× HIGH_SODIUM, 3× caffeine warn) — dedupe during review.

## Reviewer package requirements (per rule)

1. Pick authoritative citation → ensure `RuleEvidence` row exists (all Queue A/B rows already have one).
2. Supply threshold + unit + direction (`<`, `>`) and period (per-meal/per-day).
3. `clinicalAction` text must be informational, never diagnostic/prescriptive.
4. Set `reviewedBy`/`reviewedAt`/`evidenceSourceId` and flip `reviewStatus` → constraint enforces the chain.
5. Add a golden test: APPROVED rule fires; DRAFT twin stays inert (precedent: `mealSuggest.test.js` approved-vs-draft fixture).
