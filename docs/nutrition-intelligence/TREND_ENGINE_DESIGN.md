# TREND_ENGINE_DESIGN — Sprint A trend intelligence

**Module:** `src/services/trends.js` (`getTrends`, `smoothedWeight`, `GOAL_DIRECTION`). **Consumer:** `unifiedProgress.getProgress` → `GET /me/progress/unified` (flag `leo_progress_enabled`). Not a parallel engine — extends the existing progress service, same records, same TZ semantics.

## Shape (version `trends-v1`)

| Section | Content |
|---|---|
| `coverage` | days, foodLoggedDays, foodCoveragePct, weightEntries, workoutSessions, stepDays |
| `energy` | avgDailyKcal **over logged days only**, targetKcal, adherencePct, incompleteLogDays, state insufficient/partial/ok |
| `macros` | avg protein/carbs/fat/fiber + MacroGoal targets |
| `weight` | 3-pt moving-average smoothed delta, weeklyRateKg (>0.5wk span only), explicit "not a measure of fat loss" note |
| `activity` | workoutsPerWeek, workoutDays, avgDailySteps — counts only, wearable kcal never summed (`activeKcalNotes`) |
| `goal` | canonical current goal, expectedDirection map, changesInWindow from GoalHistory w/ targetsPreserved |
| `progress` | goalProgress enum: progressing/stalled/regressing/drifting/no_data |
| `reviews` | `assessWeightLossRate` only when caller passes `rapidLossBoundKgPerWeek` (null today → never fabricates a bound) |
| `provenance` | model names per stream |

## Invariants
- Missing food day = unknown, never zero; averages divide by logged days.
- <3 weight entries → `insufficient`; overall state `insufficient` below record thresholds.
- Observational: no clinical thresholds; reviewed bounds are parameters.
- TZ-safe: local-day bucketing via `Intl.DateTimeFormat(tz)`; weight/goal history use absolute timestamps.
