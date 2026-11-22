# TREND_ENGINE_VALIDATION — Sprint A

## Automated evidence
- `tests/trends.test.js` — 6 tests: insufficient-state honesty, missing-day≠zero, 3-pt smoothing + fat-loss disclaimer, GoalHistory reporting, activity counts-only, TZ/provenance labels. **All pass.**
- `tests/capabilityIntegration.test.js` — 5 tests (see CAPABILITY_INTEGRATION_REPORT).
- Affected suites re-run: trends, capabilityIntegration, scenarioFixtures (68 pass/52 todo), profile.weight, progress.route, unifiedProgress, healthSources, recipes.route, medicalFlagGovernance — **all green**.

## Full suite — honest status
Two consecutive `npm test` runs on the uncommitted tree show **18 failures confined to `tests/activitySafety.*`** (scenarios + reviewPackage). Root cause: **uncommitted activity-safety engine edits** (`constants.js`, `engine.js`, `rulesData.js`, `activityCatalog.js` — decision-rank/rule changes whose test expectations weren't updated yet — e.g. S055 expects ALLOW). Verified unrelated to Sprint A: every file this sprint touched passes; activity-safety failures reproduce standalone with trends untouched.

## Known limits
- `weeklyRateKg` requires >0.5wk entry span; else null → goalProgress `no_data` (honest).
- trends compute per request; no cache yet (unifiedProgress calls uncached too — same posture).
- Weight direction thresholds (±0.3kg) are engineering bands, documented in-code, not clinical.
- `consumedState`/`yieldFactor` on `/food-logs/intelligence`: factors exist only where dataset/sourceRecord carries one; else `state:'no_data'` — intended.
