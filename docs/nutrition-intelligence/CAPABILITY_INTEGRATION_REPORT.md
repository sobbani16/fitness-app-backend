# CAPABILITY_INTEGRATION_REPORT — six functions wired to real consumers

| Function | Consumer (production path) | Behavior | Destructive? | Test evidence |
|---|---|---|---|---|
| `planGoalSwitch` | `PUT /me/profile` (route tx) | Canonical goal diff → close old GoalHistory row, open new with targetsSnapshot; `goalChange` in response; history+scores preserved | no | `capabilityIntegration` 3 tests |
| `detectDuplicateLog` | `POST /food-logs` | ±30min same-name/fdcId lookback → advisory `duplicateWarning` + `nutritionSnapshot.possibleDuplicateOf`; log still written | no | 2 tests |
| `dedupeWorkouts` | `healthSources.ingestMeasurements` (workout metric) | same-type ±15min/duration ±3min → `meta.possibleDuplicate` flag; record retained | no | covered by unit + healthSources suite |
| `validateWearableEnergy` | `GET /progress` expenditure path | bound = 2.5×BMR (engineering bound, in-code comment); implausible → capped + `source:'wearable_capped_implausible'` | no | progress.route suite |
| `rescaleServing` | `GET /recipes/:id/nutrition?servings=N` | per-serving map rescaled; grams vs servings distinct; nulls preserved | no | recipes.route suite |
| `convertFoodState` | `POST /food-logs/intelligence` + `foodIntelligence.ingredient` | caller `consumedState`≠profile prep → conversion only with explicit `yieldFactor`/`sourceRecord.yieldFactor`; else `stateConversion:{state:'no_data'}` | no | service-level |

**Honesty rule preserved:** none of these delete or reinterpret records; all surface flags/labels for downstream handling.

## Still function-only (not wired — by design, pending consumers)
`overeatingGuidance`, `supplementQuestionPolicy`, `assessWeightLossRate` (wired INTO trends but bound is null → inactive), `detectOutcomeDivergence` (trends produces `goalProgress` input; consumer monitor pending), `assessNutrientCaution`.
