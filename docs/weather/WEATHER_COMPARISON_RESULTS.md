# Weather Comparison — Observed Results (pc-HUM-8)

_Audit-only run. No recommendation logic, rules, thresholds, migrations, or
deployed config changed. Companion doc: `WEATHER_RECOMMENDATIONS_INVENTORY.md`._

## Method

- Runner: `docs/weather/compare-weather.js` → `node docs/weather/compare-weather.js`
- Fixed inputs: clock `2026-11-24T14:00:00Z`; synthetic healthy-adult context
  (`{conditions:[], injuries:[], symptoms:[], surgeries:[], restrictions:[], preferences:{}}`);
  candidate `outdoor_walk` + `indoor_walk` control; `rules: []` (structural
  engine only, matching `activitySafety.envMatrix.test.js` convention); balance
  `{surplus:-50}` → v1 base "Close to target".
- Only the observation varies. All fixtures are complete and fresh unless the
  case is `stale`/`missing`. Units: temp/apparent °C, AQI us_aqi, precip mm,
  wind km/h, WMO weather codes.
- Three real entry points exercised per case (no provider calls):
  - **v1 (legacy)** — `weatherService.deriveCondition` →
    `recommendationEngine.recommendFromBalance`. Intermediate result: the API
    response fields `location`/`weatherAdjusted` (what `/recommendations`
    returns — narration framing aside, no further gating exists downstream).
  - **v2 eval** — `activitySafety.evaluate(ctx, activity, env, {rules})`
    decision + reasons (per-candidate verdict).
  - **v2 recommend** — `activitySafety.recommend(ctx, env, {rules})`
    `disposition`+`suggestion` — the producer-facing final recommendation.

## Results (vs 20 °C clear-sky baseline)

| case | obs | v1 condition → location (adj?) | outdoor_walk | indoor_walk | recommend() suggestion |
|---|---|---|---|---|---|
| baseline | 20C, code 1, AQI 30, 0mm | pleasant → either (false) | ALLOW | ALLOW | outdoor_walk (ALLOW) |
| rain | 20C, code 61, AQI 30, 2mm | rainy → either (false) | ALLOW | ALLOW | outdoor_walk (ALLOW) |
| heat | app 42C, code 1, AQI 30 | hot → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |
| cold | app −20C | pleasant → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |
| aqi | 20C, AQI 160, code 1 | pleasant → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |
| thunder | 20C, code 95 | rainy → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |
| stale | 3h old | pleasant → either (false) | INSUFFICIENT_DATA | ALLOW | indoor_walk (ALLOW) |
| missing | unavailable | — → n/a | INSUFFICIENT_DATA | ALLOW | indoor_walk (ALLOW) |
| edge-40.4 | app 40.4C | hot → either (false) | MODIFY | ALLOW | indoor_walk (ALLOW) |
| edge-40.5 | app 40.5C | hot → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |
| edge-40.6 | app 40.6C | hot → either (false) | DEFER_OUTDOOR | ALLOW | indoor_walk (ALLOW) |

Representative reasons: heat → "Heat index in the NWS danger range — outdoor
exertion deferred."; AQI 160 → "AQI 160 (unhealthy) — outdoor exertion deferred
per EPA guidance."; stale → "Weather data is stale — cannot verify current
conditions. No outdoor-safety claim is made."

## Confirmed findings

**F1 — v1 `applyWeather` is inert (dead code).** Minimal repro: any input —
every `pickBase`/`noLogsYet` base returns `type ∈ {log|review|maintain|eat_regular}`
and `location:'either'`, so `applyWeather`'s only mutations
(`outdoor→indoor`, `either→outdoor` when `type==='workout'`) can never fire.
Observed: `weatherAdjusted=false` in all 11 cases. Supporting contract:
`recommendationEngine.js` lines 104–114 + base catalog lines 34–94; the
honesty comment at lines 28–30 says callers must not claim weather was applied
unless `weatherAdjusted` — which is now never. Path: `/recommendations`,
`/summary`. Classification: **unresolved policy question** — is the v1 weather
input meant to do anything? If kept, clients cannot rely on it.

**F2 — v1 has no hazard semantics; buckets can contradict v2.** Minimal repro:
obs `{tempC:-20, apparentTempC:-20, code:1, aqi:160}` → v1 `condition:'pleasant'`
(safe-sounding) while v2 `DEFER_OUTDOOR` (cold_danger + aqi_unhealthy).
Similarly thunderstorm (code 95) → v1 `'rainy'`, indistinguishable from drizzle.
Supporting contract: `weatherService.deriveCondition` (precip/temp only — no
AQI, UV, wind, alerts, feels-like) vs `environment.js detectHazards`.
Path: any client consuming `/weather.condition` for advisory UX (mobile
`weatherContext.ts` does). Classification: **confirmed inconsistency**
(latent — v1 narration is display text; the safety engine is the gate, so no
unsafe suggestion is actually emitted today, but the two vocabularies disagree
on the same observation).

**F3 — boundary cutoff behaves as configured.** `apparentTempC` 40.4 → MODIFY
(heat_extreme_caution), 40.5 → DEFER_OUTDOOR (heat_danger, `>= 40.5`), 40.6 →
DEFER_OUTDOOR. Matches `environment.js` lines 49–52 exactly. Classification:
**correct behavior** (documents the discontinuity — a 0.1 °C change flips
defer vs modify; no hysteresis by design).

**F4 — fail-closed paths verified.** Provider outage (`available:false`) and
3h-stale obs → `INSUFFICIENT_DATA` on outdoor candidates only; indoor stays
ALLOW; `recommend()` still yields `indoor_walk` rather than nothing. Rain
(2mm, WMO 61) correctly stays ALLOW (below 5mm `heavy_precip`). Classification:
**correctly filtered suggestions**, consistent with `environment.js` contract.

## Sensitive-profile & alert sweep (increment 3 — same harness, ctx varies only)

Profile flags arrive via four real input shapes — `ctx.flags:Set`, `ctx.conditions`,
`ctx.pregnancyStatus`, `ctx.ageYears` (merged by `buildFlags`, engine.js:375-379).
Identical observation per pair; only ctx differs.

| case | obs | healthy | flagged | basis |
|---|---|---|---|---|
| AQI 110 | 20C clear | ALLOW | **MODIFY** (asthma flag, age 66) | AQI_USG ≥101 only when aqiSensitive |
| apparent 35.5C | clear | MODIFY (≥32) | **DEFER_OUTDOOR** (pregnancy) | HEAT_SENSITIVE_DANGER ≥35 |
| apparent 29C | clear | ALLOW | **MODIFY** (ms condition) | HEAT_CAUTION ≥28 only when heatSensitive |
| apparent −10C calm | clear | ALLOW | **MODIFY** (asthma flag) | COLD_CAUTION via coldSensitive |
| alert: 'Winter Storm Warning' | 20C clear | DEFER_OUTDOOR | — | SEVERE_ALERT via `/warning\|severe\|…/` on alertText |
| alert: 'Thunderstorm outlook' | 20C code 1 | DEFER_OUTDOOR | — | THUNDERSTORM via `/thunder\|lightning/` |
| alert: 'Frost Advisory' minor | 20C clear | ALLOW | — | advisory text matches no severe regex — watch-vs-warning granularity |

Verified: all four flag input shapes produce identical tightening; indoor
control stays ALLOW in every case; `recommend()` substitutes indoor_walk;
v1 `deriveCondition` maps ALL of the above to 'pleasant'/'hot' — the bucket
vocabulary cannot represent any of them (extends F2). Alert-text hazards are
reachable only when providers populate `env.alerts`; `alertsAvailable:false`
downgrades to INSUFFICIENT_DATA rather than silently clearing (environment.js:161).

## Unverified / out of scope

- `safetyGate`-without-env behavior in producers (personalPlans, chat,
  trainerCopilot, etc.) — audited statically in the inventory doc; not
  exercised here because it requires a DB-backed context (all callers pass
  `env=null`, so outdoor candidates get INSUFFICIENT_DATA inside gate context
  — flagged as an integration question, not confirmed as a defect).
- `EnvironmentalObservation` persistence path — unused; evaluations can't be
  tied back to a stored observation.
- India/US provider payload branches — fixtures covered WMO codes and alert
  text; provider normalization (IMD vs NWS shapes) not swept.
- `aqi_very_unhealthy`/`smoke` keys — unreachable by `detectHazards` (noted in
  inventory); confirmed by absence in this matrix but not separately probed.
- Sensitive-profile × hazard cross-product beyond the sampled bands (e.g.
  heat_sensitivity med-flag pair, wheelchair + storm) — the flag merge is
  verified; full combinatorial sweep not run.
- Mobile `weatherContext.ts` client-side thresholds vs engine — display-only;
  not run (backend audit).

## Tests run

`npx jest tests/activitySafety.envMatrix.test.js tests/environmentService.test.js
tests/weatherService.test.js tests/recommendationEngine.test.js
tests/summaryService.test.js --runInBand` → **51/51 passed**.

---

# #15 — Prisma client mismatch in symptom reporting: root cause + resolution (2026-11-26, branch humai/dev-04/pc-HUM-8-weather-audit @ f57e926)

## Root cause
`node_modules` in this worktree was previously a symlink to the shared checkout, whose Prisma client had been regenerated by another agent against a newer schema carrying a `version` column on `UserSymptomReport`. The branch schema (`prisma/schema.prisma`) has no such column, so every `userSymptomReport.create()` failed with `PrismaClientKnownRequestError: column 'version' does not exist` — making `tests/asyncScenarios*.test.js` fail deterministically (matches CI_RELIABILITY_ADDENDUM_2026-11-26.md finding). Compounding factor: the interrupted first `npm ci` left a partial install with prisma CLI 7.x present, which cannot even validate this schema (P1012 — Prisma 7 dropped `url` in datasource blocks).

## Reproducible setup (fix)
1. `rm` the `node_modules` symlink in the task worktree only; `npm ci` to completion (lockfile pins prisma/@prisma/client 6.19.3).
2. `npx --no-install prisma generate --schema prisma/schema.prisma` → generates into `./node_modules/@prisma/client` (worktree-local, verified).
3. Client metadata now matches the checked-out schema exactly — fields: `id,userId,symptoms,severity,context,persistence,status,source,reportedAt,resolvedAt,triageOutcome,user,createdAt`; phantom `version` gone.

## Isolation
Designated isolated database per TEST_DATABASE_ISOLATION_REPORT.md guards: loopback host, test-named (`fitness_test_dev04` on localhost), `TEST_DATABASE_URL` env only — never printed. `tests/setup.js` guards pass.

## Verification results (actual execution, `--runInBand`)
- `tests/asyncScenarios.test.js` + `tests/asyncScenarios.api.test.js`: **2/2 suites, 17/17 tests PASS** — HTTP 201 on symptom recording, persisted records, urgent vs non-urgent dispositions, recommendation suppression assertions all green. This is the #15 designated verification target: RESOLVED.
- Full suite `npx --no-install jest tests --runInBand` on the confirmed isolated target: 154 passed / 3 failed / 2 skipped of 159 suites; 6032 passed / 43 failed / 4 skipped / 48 todo of 6127 tests. `platformE2E.test.js` and `retentionSweep.test.js`: NOT among the failures (pass/skip per suite totals).
- The 3 failing suites (`academy`, `e2eTrainerJourney`, `trainerNutrition` — 43 tests) fail at ~1 ms in `beforeAll` with `role.id` null: the freshly created isolated DB has **no seeded `Role` rows** and the repo seed (`node prisma/seed.js` — ran; seeds 33 supplements) does not populate roles. Precise guard reason: a test-fixture seed gap in the new isolated database, unrelated to the #15 client defect and unrelated to product behavior. No schema/migration change needed for #15 alignment — none was made.

## Independent QA reproduction
1. In a clean worktree at this SHA: `npm ci` then `npx --no-install prisma generate`.
2. Point `TEST_DATABASE_URL` at a loopback test-named database with migrations applied (`prisma migrate deploy` against it).
3. `npx --no-install jest tests/asyncScenarios.test.js tests/asyncScenarios.api.test.js --runInBand` → expect 17/17.
4. For the three seed-dependent suites, populate `Role` rows first (gap documented above).
