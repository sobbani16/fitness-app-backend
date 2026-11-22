# Nutrition Intelligence Engine — STATUS

**Checkpoint:** Phase 1 implementation (2026-11-21, evening) — supersedes Phase 0 audit from earlier same day
**Repos:** `fitness-app-backend` @ working tree · `fitness-app-mobile` @ `42bf358` (untouched this session)

## Session summary

Applied the approved plan after Phase 0: reviewed + applied the 10 pending migrations,
populated the nutrient/clinical data layer in dev, fixed the verified score-v2 defects,
closed the unreviewed-rule safety hole across **all five consumers**, cleaned junk data,
and wrote the consolidation spec (`PIPELINE.md`). All work is local dev DB only; no
production mutation.

## Verified working

| Check | Result |
|---|---|
| `npx prisma migrate status` | **Database schema is up to date** — all 64 migrations applied (10 additive pending ones reviewed for destructive SQL first, applied via manual SQL + `migrate resolve`) |
| `npx prisma validate` | valid |
| `npx jest tests/scoreV2.route.test.js --runInBand` | PASS — 8 tests (new route suite) |
| `npx jest tests/mealSuggest.test.js --runInBand` | PASS — 13 tests (incl. new APPROVED-gate + DRAFT-inert assertions; suite now cleans its own `ms*` residue) |
| Full touched-area suite (13 files: scoreV2, mealSuggest, safety, healthScore, weeklyPlan, aiWeeklyGenerator, weeklyHealthReview, conditionRules, recommendationEngine, recommendations.route, nutritionStatus, dailyProgress, macroScore) | PASS — 178 tests |
| `node scripts/audit-junk-data.js` (dry-run) | idempotent — all actions 0 post-apply; report at `junk-data-report.json` |

## Defects fixed this session

| # | Was | Now |
|---|---|---|
| B1 | score-v2 crashed selecting `type`/`durationMin` on WorkoutSession | uses `workoutType`/`durationMinutes`; regression test added |
| B2 | `FoodLog.micronutrients` missing locally | migration applied |
| B3 | `foodQuality:{}` / unreachable safety gate | wired from `nutrientStatus` (addedSugar/satFat/sodium; trans>0 flags PHO path) |
| B4 | scored vs generic FDA DVs | `MacroGoal` first (±20% kcal band matching `computeDay`), DV fallback, `targetSource` in response |
| B8 *(new)* | `ConditionRule` DRAFT rows acted in 4 consumers | all five consumers (`mealSuggestion`, `healthScoreEngine`, `ingredientValidator`, `supplementValidator`, `weeklyDietGenerator`) gate on `reviewStatus:'APPROVED'`; DRAFT-inert test added |
| B6 | 51 `ms*` ingredients / 54 allergies / 55 conditions / 66 recipes test residue; 15 `dummy-*` fdcIds; 1 row >900 kcal/100g — all also baked into `seed-foods.js` | DB cleaned (`scripts/audit-junk-data.js --apply`, idempotent); `seed-foods.js` scrubbed (31 `ms*` rows removed, dummies nulled) |

## Data layer state (local dev DB, post-work)

- `Nutrient`: **27** · `IngredientNutritionProfile`: **18** (all USDA-verified) · `IngredientNutrient`: **486**
- `RuleEvidence`: **12** · `HealthConditionNutrientRule`: **14** (all DRAFT) · `ConditionRule`: 83 → **3** clinical_ingredient DRAFTs + legacy rows cleaned — *see note below*
- `ScenarioDefinition`: **120** seeded, all `pending_review`
- Audit correction: the 80 legacy `ConditionRule` rows **pre-dated today** (created June–Nov 18; earlier count read them as absent). Phase-0 text "0 condition rules" was wrong for that row.
- `Ingredient`: 478 rows post-clean (was 529); `Allergy`: 2 (`peanut`, `Peanuts` — plural near-dup, report-only); `HealthCondition`: 22 canonical + Pregnancy present
- `IngredientNutritionProfile` coverage: 510/529 still unmatched — 349 `NO_RELIABLE_SOURCE_MATCH`, 161 `SOURCE_RECORD_UNAVAILABLE`, 1 manual review (broccoli raw: FDC 170379 vs 747447)

## Still open / known issues

- v1 `healthScoreEngine` still serves `/health-score` (hardcoded fallback targets, heuristic penalties) — D11 pending; now gated to APPROVED rules at least.
- `calorieFloor` intentionally `null` until G4 policy.
- 12 normalizedName dup groups, 2 zero-kcal ingredients, `peanut`/`Peanuts`, **1817 `@test.dev` users** — report-only in `junk-data-report.json`.
- 120 scenarios + 14 nutrient rules + 3 clinical rules all unreviewed (DRAFT/pending_review — correctly inert).
- Life-stage/medication/ED context unpopulated → `decisionEngine` triggers dormant.

## Resumption

Read `STATUS.md` → `NEXT_STEPS.md` → `PIPELINE.md` → `DECISIONS.md`. Never `migrate dev`/`reset` (AGENTS.md drift). Junk cleanup re-runnable: `node scripts/audit-junk-data.js [--apply]`.
