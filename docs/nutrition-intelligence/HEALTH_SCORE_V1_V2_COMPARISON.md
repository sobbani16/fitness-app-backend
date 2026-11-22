# HEALTH_SCORE_V1_V2_COMPARISON — behavioral matrix

**Generated:** 2026-11-21 · executable evidence: `tests/scoreComparison.test.js` (11 tests, all passing) · `tests/healthScore.test.js` (25) · `tests/scoreV2.route.test.js` (8)

Engines are **not** score-equivalent by design — v1 is a contributor-penalty narrative score, v2 is a capped component sum. The comparison asserts each engine's contract on identical days and records divergences a consumer must know.

## API surface

| | v1 `/health-score` | v2 `/daily-progress/score-v2` |
|---|---|---|
| Route | `src/routes/healthScore.js` | `src/routes/dailyProgress.js` |
| Flag | none (live) | `health_score_v2` (403 `FEATURE_DISABLED` when off) |
| GET side effects | **writes** `HealthScore` + `ScoreContributor` + `HealthScoreInsight` on every call | best-effort `dailyScoreSnapshot.upsert` |
| Consumers | mobile `src/api/healthScore.ts`, `DashboardScreen`, `HealthScoreDetailScreen`, `HealthScoreCard` | none on mobile yet (flag-gated) |
| Missing data | `status: insufficient_data`, score null | `state: no_data`/`partial_data`, per-part `no_data` |

## Behavior matrix (all rows executable)

| Case | v1 | v2 | Divergence |
|---|---|---|---|
| Excess calories | no kcal component — macro adherence only; carb/fat excess → contributor penalties | `energy` part decays above `caloriesMax`, no bonus | v2 punishes energy excess; v1 only punishes macro excess |
| Severe underconsumption | low macro scores, no floor concept | `energy.state=safety_suspended` when below `calorieFloor`; composite→null | v2 can suspend; v1 silently scores low. **Floor currently null (G4 inactive)** |
| Missing meals / empty day | `insufficient_data`, score null | `no_data`, **composite 0** | v2 composite is *points earned* not availability — consumers must gate on `state` (documented consumer-education finding) |
| Incomplete nutrient coverage | column-sum: missing columns treated as 0; fiber=0 indistinguishable | `no_data` per part; unknown never zero | v2 is strictly more honest |
| Excess macros | explicit negative contributors ("Carb Excess") | adequacy caps at max points, no penalty | v1 penalizes, v2 is neutral — different user-facing semantics |
| Missing activity | `available: false` | `movement.state=no_data` | equivalent |
| Duplicate workouts | sums `durationMinutes` — 2×45min same workout double-counts (score 100) | counts sessions/minutes supplied by caller; weekly pattern credit | both count supplied minutes; v2's weekly pattern is more forgiving |
| Time zone | `localDay.dayRangeUtc` per user TZ (post-fix); Kiritimati day = 10:00Z offset | caller supplies instants | post-fix v1 correct; v2 shifts responsibility to route (uses `localDay` too) |
| Historical snapshots | HealthScore upsert by unique `(userId,date)` | DailyScoreSnapshot versioned upsert | both overwrite same-day |
| Goal changes | reads `MacroGoal` per call; FDA-DV fallback | same; `targetSource` exposed | equivalent |
| Unapproved clinical rules | query-gated `reviewStatus:'APPROVED'` (post-fix) | absent from input contract | equivalent inertness |

## Acceptance criteria for v2 activation (D11)

1. Flag-off behavior verified: 403 `FEATURE_DISABLED` — ✔ covered.
2. Golden fixtures: 120-scenario registry reviewed → currently 12/120 (see SCENARIO_VALIDATION_MATRIX) — **open**.
3. Consumer education: any UI consuming v2 must gate on `state`, never display raw composite as "score" — **open until mobile consumer exists**.
4. Calorie floor: needs approved G4 policy — **blocked on clinical review**.
5. Rollback: revert = disable `health_score_v2` flag; v1 path untouched — ready.

**Status: v2 NOT globally activated.** v1 remains the user-facing score; corrected defects are covered by 25 regression tests.
