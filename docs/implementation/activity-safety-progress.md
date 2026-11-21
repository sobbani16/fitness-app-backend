# Activity Safety Engine — Implementation Progress

**Branch:** `feat/activity-safety-engine` · **Started:** 2026-11-21
**Resume instructions:** read this file → `git log --oneline` this branch → `docs/implementation/activity-safety-open-issues.md` → continue next exact task.

## Current phase
Phase 8 producers wired (routes, voice, todayActions, reminders, mobile dashboard). Phase 9 mobile feedback UI + Phase 14 validation report next.

## Completed
- [x] Phase 1 inventory → `docs/audits/health-activity-current-state.md` (all 12 recommendation producers traced; dead paths verified)
- [x] Phase 2 evidence register + clinical review queue → `docs/clinical/` (45+ rules, all DRAFT)
- [x] Phase 3 schema + additive migration `20261221000000_activity_safety_v1` (9 models; Recipe drift excluded; `activitySafetyRule` accessor verified)
- [x] Phase 4 deterministic engine: `src/services/activitySafety/{constants,activityCatalog,environment,engine,context,index}.js` — multi-dimensional (medical/functional/environmental/personalization), structural safeguards always-on
- [x] Phase 5 rule registry: `rulesData.js` (71 rules seeded DRAFT via `scripts/seed-activity-safety-rules.js --apply`)
- [x] Phase 6 env service: `src/services/environmentService.js` — normalized Open-Meteo v2 (feels-like, humidity, wind/gusts, UV forecast, 12h window) + US AQI feed; `alertsAvailable:false` honest; stale marking
- [x] Routes: `/activity-safety/*` (recommendation, evaluate, symptoms, injuries, feedback, profile) + `GET /weather/environment` — all behind server flags (`activity_safety_engine`, `weather_intelligence_v2`, `health_aware_recommendations`, `activity_safety_shadow_mode`)

- [x] Phase 8 wiring: `/activity-safety/*` routes, voice REPORT_INJURY/REPORT_SYMPTOM + START_WORKOUT pre-check, todayActions safety_check gate, workout/movement reminder suppression on urgent symptoms, mobile dashboard suggestion path behind `healthAwareRecommendations`
- [x] Dead-path honesty: `weatherAdjusted` flag; `/summary/daily` wording fixed

## In progress
- Phase 9 mobile feedback UI + Phase 14 interim validation report

## Next exact task
Mobile feedback/report screens (API client exists) → interim `docs/audits/health-activity-safety-final-validation.md` → scenario fixture expansion toward 150.

## Files modified (mine only, this session)
- `src/services/activitySafety/*` (new: constants, activityCatalog, environment, engine, context, index, rulesData)
- `src/services/environmentService.js` (new)
- `src/routes/activitySafety.js` (new), `src/routes/weather.js`, `src/routes/index.js`, `src/routes/voice.js`
- `src/services/voice/voiceParser.js`, `src/services/todayActions.js`, `src/services/reminders/scheduler.js`
- `src/services/summaryService.js`, `src/services/recommendationEngine.js` (honesty fixes)
- `src/config/featureRegistry.js` (+4 flags)
- `prisma/schema.prisma` (+9 models + User relations), `prisma/migrations/20261221000000_activity_safety_v1/`
- `scripts/seed-activity-safety-rules.js`
- `tests/activitySafety.{engine,routes,voice,todayActions}.test.js`
- `docs/clinical/*` (evidence register + review queue)
- Mobile: `src/api/activitySafety.ts`, `src/hooks/useSafetyRecommendation.ts`, `src/services/safetySuggestion.ts`, `src/screens/DashboardScreen.tsx`, `src/hooks/useWeather.ts`, `src/config/featureKeys.ts` + test

## Tests executed
- `tests/activitySafety.engine.test.js` → **57/57** (S001–S020, env bands, lifecycle, matching, invariants, pipeline)
- `tests/activitySafety.routes.test.js` → **17/17** (flag gating, triage, injury capture+follow-ups, recommendation, evaluate, feedback, profile, PATCH)
- `tests/activitySafety.voice.test.js` → **17/17** (parser intents + execute persistence + escalation)
- `tests/activitySafety.todayActions.test.js` → **3/3** (urgent → suppress start_workout + safety_check first; restriction → suppress; clean → surfaces)
- Regression: voice, voiceParser, weather, featureFlags, summary×2, recommendationEngine+route, dailyProgress, apiReliability, reminders×2 → **166 pass, 0 fail**
- Mobile: weatherContext, useWeather, FeatureFlagsContext, betaFeatures, safetySuggestion → **30 pass**; `tsc --noEmit` clean; eslint clean

**Total activity-safety coverage: 94 backend + 6 mobile = 100 tests, all passing**

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
- `a816447` routes + voice capture + dead-path honesty fixes (+34 tests)
- Mobile `7d4c3d1` health-aware suggestion path behind flag (mobile repo, main branch)
