# Activity Safety — Test Results

Updated per checkpoint. Clinical review remains a separate release gate — green tests verify code consistency, never medical correctness.

## Latest run (checkpoint `9eb0bdd`)

| Suite | Result | Notes |
|---|---|---|
| `tests/activitySafety.engine.test.js` | **57/57 pass** | engine-level, no DB |
| Module sanity (`node -e require`) | pass | routes+services load |
| `tests/weatherService.test.js` (pre-existing) | 10/10 pass | audit phase |
| Mobile weather tests (pre-existing) | 15/15 pass | audit phase |

## Scenario coverage in the engine suite (57 tests)

**Required scenarios S001–S020** — all covered including S002 NWB per-candidate evaluation, S005 asthma+AQI bands, S006 urgent escalation on all candidates (incl. `rest`), S007/S008 pregnancy allow-vs-escalate, S010 wheelchair accessible candidates, S011 surgery-no-clearance + elapsed-time invariant, S016 context-reload invalidation, S017 rest suppression, S019 fitness score never overrides, S020 rule-match boundary.

**Environmental bands** — heat index 32/35/40.5 tiers incl. sensitive tightening, AQI 50/140/170/250 bands, cold wind-chill, severe alerts, heavy precip vs light rain, `alertsAvailable:false` → `severe_weather_alerts` requiredData, better-time only when the blocking hazard resolves in real forecast hours (AQI deferral never invents a time), stale observation → INSUFFICIENT_DATA.

**Injury lifecycle** — resolved ≠ current, unmapped body part → INSUFFICIENT_DATA, severe undiagnosed pain → NEEDS_CLINICAL_REVIEW, expired clinician restriction → review (never auto-clears), expired self restriction → inactive, multi-injury compounding, immersion restriction blocks swimming.

**Rule matching** — AND-across/OR-within groups, exclusion veto, resolved injuries inert, DRAFT rules never fire live (load is APPROVED-only by default).

**Invariants** — determinism, perfect weather never overrides clinical prohibition, urgent symptoms dominate, audit metadata present, °C/°F-normalized decisions agree, per-user isolation.

**Pipeline** — NWB suggestion excludes weight-bearing, suppressed_urgent payload, independently-evaluated alternatives, all-blocked → no_safe_candidate (never forced suggestion).

## Route tests
Pending — next task (mocked prisma, AUTH_TEST_BYPASS pattern per existing suite conventions).

## DB verification
- `npx prisma validate` pass; `migrate status` = up to date (65 migrations)
- `activitySafetyRule` accessor live; 71 rows seeded `DRAFT`
- Approval CHECK constraint confirmed in migration (mirrors ConditionRule precedent)
