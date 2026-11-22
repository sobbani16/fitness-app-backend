# NUTRITION_ENGINE_INTEGRATION_STATUS — exists vs wired vs approved

**Rule:** a passing pure-function test does NOT count as integration. Columns: exists → wired into a production call path → end-to-end tested → clinically approved → activation-eligible.

## Scoring/decision engines

| Function | Exists | Wired in call path | E2E tested | Clinically approved | Eligible |
|---|---|---|---|---|---|
| `dailyScore` (dps-v2.1) | ✔ | `GET /daily-progress/score-v2` behind `health_score_v2` | ✔ route suite + 30 fixtures | pending (wellness framing) | founder cohort only |
| `decisionEngine.resolve` | ✔ | `reminders/scheduler.js` (suppression); scenario outcomes not yet surfaced | ✔ unit fixtures | pending copy review | internal |
| `healthScoreEngine` (v1) | ✔ | `GET /health-score` live | ✔ 25 tests | n/a wellness | live |

## scenarioCapabilities.js — 6/11 WIRED (Sprint A 2026-11-21): planGoalSwitch→profile PUT, detectDuplicateLog→food-logs POST, dedupeWorkouts→healthSources ingest, validateWearableEnergy→GET /progress, rescaleServing→GET /recipes/:id/nutrition, convertFoodState→food-intelligence. Remaining 5 function-only by design.

| Function | Wired where | What integration needs | Eligible |
|---|---|---|---|
| `overeatingGuidance` | — | coaching/education surface + copy review | no |
| `dedupeWorkouts` | — | workout-session ingestion path (mobile+backend) before scoring/energy | eng-safe to wire |
| `supplementQuestionPolicy` | — | `supplement_safety` flag + pharmacist content | no — clinical |
| `convertFoodState` | — | normalizer stage + provenance factor table | eng-safe once factors sourced |
| `rescaleServing` | — | recipe serving-change path | eng-safe |
| `detectDuplicateLog` | — | food-log write path (barcode+photo) | eng-safe |
| `validateWearableEnergy` | — | health-source ingestion before calorie allowance | eng-safe |
| `assessWeightLossRate` | — | weight-trend monitor (doesn't exist) | needs reviewed bound |
| `detectOutcomeDivergence` | — | outcome monitor (doesn't exist) | eng-safe design, needs trend data |
| `planGoalSwitch` | — | profile goal-update route + GoalHistory writes | eng-safe (policy only) |
| `assessNutrientCaution` | — | nutrient surfacing; warns only above reviewed limit | needs reviewed limit |

## New medical flags — registered, resolving false, zero consumers by design

`allergen_warnings`, `calorie_floor_policy`, `condition_rules`, `supplement_safety`, `medication_interaction` — created default OFF, fail-closed, `medical` group; verified resolving `false`. Wiring them to consumers is future gated work — the flag existing changes nothing user-facing.
