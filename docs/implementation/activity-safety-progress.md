# Activity Safety Engine — Implementation Progress

**Branch:** `feat/activity-safety-engine` · **Started:** 2026-11-21
**Resume instructions:** read this file → `git log --oneline` this branch → `docs/implementation/activity-safety-open-issues.md` → continue next exact task.

## Current phase
Phase 4–6 core complete; wiring recommendation producers (Phase 8) + tests next.

## Completed
- [x] Phase 1 inventory → `docs/audits/health-activity-current-state.md` (all 12 recommendation producers traced; dead paths verified)
- [x] Phase 2 evidence register + clinical review queue → `docs/clinical/` (45+ rules, all DRAFT)
- [x] Phase 3 schema + additive migration `20261221000000_activity_safety_v1` (9 models; Recipe drift excluded; `activitySafetyRule` accessor verified)
- [x] Phase 4 deterministic engine: `src/services/activitySafety/{constants,activityCatalog,environment,engine,context,index}.js` — multi-dimensional (medical/functional/environmental/personalization), structural safeguards always-on
- [x] Phase 5 rule registry: `rulesData.js` (71 rules seeded DRAFT via `scripts/seed-activity-safety-rules.js --apply`)
- [x] Phase 6 env service: `src/services/environmentService.js` — normalized Open-Meteo v2 (feels-like, humidity, wind/gusts, UV forecast, 12h window) + US AQI feed; `alertsAvailable:false` honest; stale marking
- [x] Routes: `/activity-safety/*` (recommendation, evaluate, symptoms, injuries, feedback, profile) + `GET /weather/environment` — all behind server flags (`activity_safety_engine`, `weather_intelligence_v2`, `health_aware_recommendations`, `activity_safety_shadow_mode`)

## In progress
- Phase 8 wiring: voice route symptom/injury capture + recommendation producers on engine

## Next exact task
Route-level tests for `/activity-safety/*` (mocked prisma) + wire voice injury/symptom capture into `src/routes/voice.js` + point mobile weather suggestion at `GET /activity-safety/recommendation` behind flag.

## Files modified (mine only, this session)
- `src/services/activitySafety/*` (new: constants, activityCatalog, environment, engine, context, index, rulesData)
- `src/services/environmentService.js` (new)
- `src/routes/activitySafety.js` (new), `src/routes/weather.js`, `src/routes/index.js`
- `src/config/featureRegistry.js` (+4 flags)
- `prisma/schema.prisma` (+9 models + User relations), `prisma/migrations/20261221000000_activity_safety_v1/`
- `scripts/seed-activity-safety-rules.js`, `tests/activitySafety.engine.test.js`
- `docs/clinical/*` (evidence register + review queue)

## Tests executed
- `npx jest tests/activitySafety.engine.test.js --runInBand` → **57/57 pass** (S001–S020 family, env bands, injury lifecycle, mobility, rule matching, invariants, recommend pipeline)
- Module sanity: routes + services load without DB
- Node probes: NWB ankle, thunderstorm, AQI bands, heat-sensitive MS, expired-clinician-restriction, unmapped body part, stale env — all verified before Jest run
- Prior: backend weatherService 10/10; mobile weather 15/15 (audit phase)

## Failing tests
None from activity-safety work. Pre-existing: `A06` nutrition fixture intentionally red (user WIP).

## Pending migrations
`20261221000000_activity_safety_v1` applied locally (additive, drift-filtered). Production apply pending deploy pipeline.

## Clinical review blockers
- 71 `activitySafetyRule` rows all `reviewStatus=DRAFT` — inert for live users until clinician APPROVED (migration CHECK requires reviewedBy/reviewedAt).
- `docs/clinical/clinical-review-queue.md` lists the high-risk cases requiring qualified review before activation.

## Known limitations (as of this checkpoint)
- `alertsAvailable:false` — Open-Meteo has no NWS alert feed; thunderstorm inferred from WMO codes only. Real alert provider needed for production.
- UV pulled from nearest forecast hour (free tier has no current UV).
- `group_indoor` activity category referenced by AS-SYS-004 but not yet in catalog.
- Voice/coaching/notification producers not yet wired to engine.
- Mobile still uses local weather buckets — backend recommendation path not yet consumed.
- `recommend()` alternatives: `rest` is eligible by design (recovery is a valid choice).

## Commit IDs
- `359648e` Phase 1 inventory + progress tracking
- `9eb0bdd` schema + engine + env service + routes + rules + 57 tests
