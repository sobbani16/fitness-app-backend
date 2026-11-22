# Nutrition Intelligence — Consolidation Pipeline Spec

**Status:** specification (2026-11-21). Describes the single intended pipeline and how the
existing engines coexist today vs. converge. Companion docs: `AUDIT.md` (what exists),
`DECISIONS.md` (open calls), `SAFETY_CASE.md`, `DATA_QUALITY.md`.

## Current state: five engines, three families

| Engine | Role today | Gaps |
|---|---|---|
| `healthScoreEngine.js` | v1 `/health-score` composite | hardcoded fallback targets (protein 150/carbs 250/fat 70/fiber 30), heuristic per-item quality penalties |
| `scoringV2.js` + `/daily-progress/score-v2` | `dps-v2` composite, flag-gated | snapshot persistence only (no trend UI), `calorieFloor` unused pending G4 |
| `nutritionRecommendation.js` | food recommendations vs targets | DV-based, not goal-aware end-to-end |
| `recommendationEngine.js` | pacing nudges (`recommendFromBalance`) | display-only, no score coupling |
| `mealSuggestion.js` | "what should I eat" eligibility + rank | keyword-match allergens; unknown lists unprovable |
| `safety/safetyPipeline.js` + `ingredientValidator`/`supplementValidator`/`nutritionValidator` | hard-stop validation layer | per-call recompute; no shared context object |

All five ConditionRule consumers now gate on `reviewStatus: 'APPROVED'` (fixed
2026-11-21 — DRAFT rows were previously live in mealSuggestion/validators/v1 score/weekly
generator). `HealthConditionNutrientRule` consumers were already gated.

## The intended pipeline (10 stages)

```
inputs ──► 1 source-id ──► 2 normalize ──► 3 provenance/prep ──► 4 nutrient calc
        ──► 5 user context+targets ──► 6 safety rules ──► 7 recommend/rank
        ──► 8 (optional AI, revalidated) ──► 9 score+snapshot ──► 10 flags/rollout
```

### 1. Input / source identification
Entry points: manual food log, barcode (`BarcodeProduct`, OFF), label scan, recipe, meal
plan item, AI-parsed text (untrusted — revalidated at stage 8). Every input carries
`source` + `sourceMetadata`; USDA `fdcId` is the canonical external key (`@unique`).

### 2. Normalization
`Ingredient.normalizedName` (lowercase) drives matching + dedupe. **Known debt:** 12
duplicate normalizedName groups (`bread`×9, `chicken curry`×3, pad-thai variants) — needs a
canonical-merge job with user-link repointing (D-series decision). Recipe lines are
name-matched (`RecipeIngredient.ingredientName`), not ID-resolved — stage-2 work should
introduce ID resolution with name fallback and explicit unresolved markers.

### 3. Provenance + preparation
`IngredientNutritionProfile` carries `source`, `sourceDataset`, `sourceFoodId`,
`preparationType` (raw/cooked per `NutritionPreparation`), SHA-256 citation. Rule: **raw
and cooked are different profiles, never averaged**. USDA FDC is the primary licensed
source; IFCT stays gated on license (see `conditionRuleImport`/population importers).
`IngredientServing` supplies portion grams; `Recipe.finishedYieldG`/`portionG` supply
cooked-yield (141/371 recipes missing → report-only, never infer silently).

### 4. Nutrient calculation + missingness
`nutrientStatus` aggregates `FoodLog` native columns + whitelisted `micronutrients`/
`nutritionSnapshot` keys (`nutrientCatalog` is the only key authority). **Missing ≠ zero**:
per-log coverage is `complete|partial|none`; a nutrient with no contributors is
`value: null`, `coverage: 'none'`. Consumers must propagate `null`, never coerce to 0.

### 5. User context + personalized targets
Precedence (decided D4): `MacroGoal` → per-nutrient targets; else `referenceIntake`
(FDA_DV / NIH_AI) from `nutrientCatalog`. score-v2 derives `caloriesMin/Max` as
`caloriesTarget ±20%` — matching `computeDay`'s tolerance. `calorieFloor` stays `null`
until a reviewed low-intake policy exists (open G4). Life-stage/medication/eating-disorder
context fields are unpopulated → `decisionEngine` triggers can't fire locally (recorded gap).

### 6. Safety / clinical rule evaluation
Two rule families, both inert unless `APPROVED`:
- `ConditionRule` (attribute block/warn on ingredient/supplement targets)
- `HealthConditionNutrientRule` (threshold rules w/ evidence citations)

Precedence: **hard exclusion (allergy/NEVER_RECOMMEND/condition block) > warn >
ranking**. Attribute rules act only where composition evidence exists (`IngredientAttribute`);
absence of a match is *not proof of safety* — surfaces stay labeled "not a clinical
guarantee". DB-level CHECK constraint enforces `reviewedBy/reviewedAt/evidenceSourceId/
clinicalAction` on every APPROVED rule. `decisionEngine` resolves escalations:
`medical_escalation > professional_review_required > need_more_information > auto_feedback`.

### 7. Recommendation ranking
Single ranking path target: `mealSuggestion` (occasion + preference + familiarity +
portion-share scoring) becomes the ranker; `nutritionRecommendation` folds in as the
target-gap signal; `recommendationEngine` pacing stays display-context. No engine may
size food to a provisional deficit ("empty log is not a deficit to force-feed").

### 8. Optional AI (strictly revalidated)
`aiWeeklyGenerator` drafts → `weeklyDietGenerator` re-enforces every deterministic rule
(attribute blocks, APPROVED nutrient rules, portions) on the AI output; violations are
replaced, not patched. AI never introduces recipe IDs, nutrients, rules, or claims not in
server-authorized data; AI kill switch + per-user quota sit in `featureFlags`/aiProvider.

### 9. Scoring + snapshots
`scoringV2.dailyScore` is the single composite (nutrition 40 / quality 20 / activity 20 /
sleep 15 / hydration 5, weights never redistribute, `SCORE_VERSION='dps-v2'` pinned in
every `DailyScoreSnapshot`). States: `no_data | partial_data | reliable | safety_suspended`.
v1 `healthScoreEngine` stays live on `/health-score` until v2 ships a trend surface +
snapshot backfill; then v1 is frozen, not deleted (rollback path). `computeDay`
(daily_progress_v2) remains the separate UI progress model — different question, kept.

### 10. Flags, kill switches, rollout, telemetry
Server-side flags (`featureFlags/service`, fail-closed): `health_score_v2`,
`nutrition_insights_v2`, `daily_progress_v2_enabled`, `food_intelligence_enabled`,
`food_barcode_scanning_enabled`, `ingredient_evidence_enabled`. Rollout: founder allowlist
→ internal cohort → % canary; rollback = flag off (v1 path untouched, snapshot reads are
additive). Telemetry: PostHog events on score state transitions, rule-fire counts, and
`INSUFFICIENT_DATA` rates — missingness is a first-class metric, not an error.

## Invariants (all stages)

1. Missing is never zero; unknown is never "safe" or "deficient".
2. Only `APPROVED` clinical rules may act; every acting rule carries evidence + reviewer.
3. Hard safety filters can never be overridden by ranking, AI, or personalization.
4. No diagnosis/treatment/dosing claims; high-risk contexts escalate to clinician paths.
5. Scores are versioned + replayable; component math is pure (no DB in `scoringV2`).

## Open gaps requiring founder/product/clinical review
- D-series: canonical merge of 12 duplicate normalizedName groups; `peanut`/`Peanuts`
  near-dup in `Allergy`.
- 1817 `@test.dev` users + 2 zero-kcal ingredients in local DB — report-only pending
  deletion policy (see `scripts/audit-junk-data.js`, `junk-data-report.json`).
- Life-stage/medication/ED context fields unpopulated → decisionEngine triggers dormant.
- `calorieFloor` policy value + WHO/ADA citation needed before enabling energy gate.
- 510 ingredients lack verified nutrition profiles (349 no reliable source match,
  161 source-record unavailable); 17 imported rules remain DRAFT pending review.
