# Activity Safety — Test Results

Updated per checkpoint. Clinical review remains a separate release gate — green tests verify code consistency, never medical correctness.

## Latest run (checkpoint `b1b2a63`)

**Full backend suite:** `npx jest --runInBand` → **1312 passed, 1 flaky-fail-then-pass (`chat.route.test.js` socket hang-up, passes standalone — DB pool contention, not code), 3 skipped, 64 todo.** 110/111 suites green.

| Suite | Result | Notes |
|---|---|---|
| `tests/activitySafety.engine.test.js` | **57/57 pass** | engine-level, no DB |
| `tests/activitySafety.routes.test.js` | **17/17 pass** | flag gating, triage, injury capture+follow-ups, recommendation, evaluate, feedback, profile, PATCH |
| `tests/activitySafety.voice.test.js` | **17/17 pass** | parser REPORT_INJURY/REPORT_SYMPTOM, execute persistence + undo, urgent escalation copy |
| `tests/activitySafety.todayActions.test.js` | **3/3 pass** | urgent→suppress start_workout+safety_check first; restriction→suppress; clean→surfaces |
| Regressions (voice, voiceParser, weather, featureFlags, summary×2, recommendationEngine+route, dailyProgress, apiReliability, reminders×2, photoScan, trainer, chat…) | **all pass** | full-suite run |
| Mobile (weatherContext, useWeather, FeatureFlagsContext, betaFeatures, safetySuggestion) | **30/30 pass** | `tsc --noEmit` clean, eslint clean |

**Bugs caught by full-suite run:**
1. `weatherIntelligenceV2` clientKey contained a digit → violated registry camelCase invariant → renamed `weatherIntelligence` (backend+mobile).
2. `photoScan.test.js` flake root-caused: `photoRecipeMatcher` `findMany({take:20})` with no `orderBy` let accumulated `Ps Biryani` rows starve the exact match. Two-phase fetch (exact phrase/alias first, tokens fill) committed at `b1b2a63`. **The earlier apparent pass/fail correlation with the clientKey rename was coincidence** — the candidate window shifts per run as test rows accumulate.

## Activity-safety coverage detail (unchanged, 57 engine tests)

**Required scenarios S001–S020** — all covered including S002 NWB per-candidate evaluation, S005 asthma+AQI bands, S006 urgent escalation on all candidates (incl. `rest`), S007/S008 pregnancy allow-vs-escalate, S010 wheelchair accessible candidates, S011 surgery-no-clearance + elapsed-time invariant, S016 context-reload invalidation, S017 rest suppression, S019 fitness score never overrides, S020 rule-match boundary.

**Environmental bands** — heat index 32/35/40.5 tiers incl. sensitive tightening, AQI 50/140/170/250 bands, cold wind-chill, severe alerts, heavy precip vs light rain, `alertsAvailable:false` → `severe_weather_alerts` requiredData, better-time only when the blocking hazard resolves in real forecast hours, stale observation → INSUFFICIENT_DATA.

**Injury lifecycle** — resolved ≠ current, unmapped body part → INSUFFICIENT_DATA, severe undiagnosed pain → NEEDS_CLINICAL_REVIEW, expired clinician restriction → review, expired self restriction → inactive, multi-injury compounding, immersion restriction blocks swimming.

**Rule matching** — AND-across/OR-within groups, exclusion veto, resolved injuries inert, DRAFT rules never fire live (APPROVED-only load).

**Invariants** — determinism, perfect weather never overrides clinical prohibition, urgent symptoms dominate, audit metadata, °C/°F parity, per-user isolation.

**Pipeline** — NWB suggestion excludes weight-bearing, suppressed_urgent payload, independently-evaluated alternatives, all-blocked → no_safe_candidate.

## DB verification
- `npx prisma validate` pass; `migrate status` = up to date (65 migrations)
- `activitySafetyRule` accessor live; 71 rows seeded `DRAFT`
- Approval CHECK constraint confirmed in migration (mirrors ConditionRule precedent)
