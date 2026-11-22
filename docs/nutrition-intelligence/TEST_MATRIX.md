# TEST_MATRIX — coverage map (2026-11-21, evening)

## New this session

| Suite | Coverage | Status |
|---|---|---|
| `tests/scoreV2.route.test.js` (new, 8 tests) | `/daily-progress/score-v2`: flag-off 403, no-crash regression (B1), real `workoutType`/`durationMinutes` fields, MacroGoal-over-DV targets + `targetSource`, DV fallback, wired foodQuality (micronutrients), trans-fat>0 → PHO zero, missing micros → `no_data` never zero | PASS |
| `tests/mealSuggest.test.js` (extended) | APPROVED ConditionRule blocks via evidence chain (RuleEvidence + clinicalAction + reviewedBy/At per DB CHECK constraint); **DRAFT rule is inert**; afterAll cleans all `ms*` fixture residue | PASS (13) |

Full touched-area run: 178 tests / 13 suites PASS (scoreV2, mealSuggest, safety, healthScore, weeklyPlan, aiWeeklyGenerator, weeklyHealthReview, conditionRules, recommendationEngine, recommendations.route, nutritionStatus, dailyProgress, macroScore).

## Existing automated coverage (backend `tests/` — 107 files)

| Area | Suite | Status |
|---|---|---|
| dps-v2 engine + primitives + registry shape | `tests/scoringV2.test.js` | PASS (25 tests, run this session) |
| Nutrient status aggregation/coverage | `tests/nutritionStatus.test.js` | PASS |
| Condition rule evaluation | `tests/conditionRules.test.js` | exists |
| Nutrient import/population | `tests/nutrientImport.test.js`, `nutrientPopulation.test.js`, `nutrientFetch.test.js` | exists |
| Food intelligence (barcode, suitability, evidence) | `tests/foodIntel.test.js` | exists |
| Label insights + access | `tests/labelInsights*.test.js`, `labelScanner*.test.js` | exists |
| Meal suggestion | `tests/mealSuggest.test.js` | exists |
| Food search/expansion, ingredient V5 | `tests/foodExpansion.test.js`, `ingredientV5.test.js`, `ingredientCatalog.test.js` | exists |
| Scores v1 / macro | `tests/healthScore.test.js`, `macroScore.test.js`, `dailyProgress.test.js` | exists |
| Estimates + AI containment | `tests/estimate.test.js`, `aiProvider.review.test.js`, `aiSchemas.review.test.js` | exists |
| Feature flags | `tests/featureFlags*.test.js` | exists |

## Scenario registry → fixture coverage

`data/scenarioRegistry.json`: 120 scenarios (A–L × 10), 50 P0 / 68 P1 / 2 P2, all `pending_review`.
`tests/scoringV2.test.js` currently asserts registry shape + engine invariants mapped to a handful of scenario IDs (A02 floor, A06 no bonus, K07 unknown≠zero, F04 rest-day). **Executable fixture coverage ≈ ~10 of 120 scenarios.**

| Category (10 ids each) | P0 count | Executable fixtures today |
|---|---|---|
| goal_energy (A) | 5 | partial (floor, bonus-cap) |
| macros (B) | 6 | ~2 (protein cap, sugar penalty absence) |
| food_quality (C) | 4 | ~2 (PHO flag, unknown trans fat) |
| micronutrients (D) | 0 | none |
| meal_timing (E) | 3 | none |
| training (F) | 4 | ~2 (rest day, weekly adherence) |
| sleep_stress (G) | 3 | ~1 (sleep bands) |
| digestive (H) | 3 | none |
| medical (I) | 6 | ~2 (rule inertness, escalation sets) |
| supplements_special (J) | 4 | ~1 (supplement separation) |
| logging_uncertainty (K) | 8 | ~3 (missing≠zero, partial window, conflicts) |
| outcomes (L) | 4 | none |

## Golden fixtures required by master prompt — gap list

Raw/cooked rice · roti size variants · dal tadka (oil used vs retained) · paneer butter masala · ghee · almonds vs almond butter · fruit vs juice · sugary drinks · hidden cooking oil · incomplete days · exercise days · medication uncertainty · allergy/cross-contact · pregnancy · minors · kidney disease · ED signals · prompt-injection via barcode/recipe text · forged source claims · unit confusion (katori/ladle/tsp/tbsp) · zero-vs-null · ambiguous portions · unsafe substitutions.

**None exist as fixtures today.** This is the largest test gap.

## Recommended build order (maps to NEXT_STEPS)

1. ~~Route test for `/daily-progress/score-v2`~~ — DONE (`tests/scoreV2.route.test.js`).
2. `tests/scoringV2.fixtures.js` per phase0 plan §H — boundary, overconsumption cap, floor suspension, conflicting snapshot, rest-day.
3. Golden-fixture harness: fixture = {input logs/profiles, expected findings, tolerances}; start with the 8 highest-risk foods (rice raw/cooked, dal tadka, paneer butter masala, ghee, almonds, juice, soda, hidden oil).
4. Adversarial suite: barcode text injection, forged `sourceCitation`, swapped units, `fiberG=0` vs `fiberG=null`.
5. Flag-off regression: v1 endpoints unchanged when `health_score_v2`/`nutrition_insights_v2` false.
6. Data-quality script checks (DATA_QUALITY.md §recommended) run as a test against a fixture DB.

## Addendum — 2026-11-21 remediation phase

| Suite | Tests | Covers |
|---|---|---|
| `tests/scoreComparison.test.js` (new) | 11 | v1↔v2 behavioral parity: excess kcal, underconsumption, empty day, partial coverage, excess macros, missing activity, duplicate workouts, TZ windows, snapshots, goal changes, DRAFT-rule inertness |
| `tests/calorieSafety.test.js` (new, prior) | 12 | G4 fixtures: low-weight, older, adolescent, pregnant, lactating, highly active, CKD, ED-risk, aggressive deficit, healthy adult, maintenance, insufficient data |
| `tests/healthScore.test.js` (updated) | 25 | v1 fixes: TZ windows, MacroGoal/DV targets, supplement separation, no rest-day penalty, no double-penalty, honest wording |
| `tests/mealSuggest.test.js` (updated) | 13 | APPROVED-rule fires / DRAFT inert, fixture self-cleanup |
| `tests/scoreV2.route.test.js` (prior) | 8 | flag-off 403, empty day, real workout fields, MacroGoal/DV targetSource, micronutrient wiring, PHO path |

**Full suite: 106 / 1,160 / 0 fail.** Scenario registry: 12/120 executable (see SCENARIO_VALIDATION_MATRIX).
