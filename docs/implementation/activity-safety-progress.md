# Activity Safety Engine — Implementation Progress

**Branch:** `feat/activity-safety-engine` · **Started:** 2026-11-21
**Resume instructions:** read this file → `git log --oneline` this branch → `docs/implementation/activity-safety-open-issues.md` → continue next exact task.

## Current phase
Phase 14 release validation in progress: eligibility audit done (`seated_movement` restrictable; `rest` is non-exercise fallback), clinical review package generated (4 structural mirrors + 22 inert-as-encoded rules documented), **NWS alerts live-integrated** (US+territories), shadow-disagreement report generated (39 stricter / 0 LOOSER), tie-break merge bug fixed, trainer privacy leak T-1 closed. Remaining = clinical review gate + real staging deploy.

## Completed
- [x] Phase 1 inventory → `docs/audits/health-activity-current-state.md` (all 12 recommendation producers traced; dead paths verified)
- [x] Phase 2 evidence register + clinical review queue → `docs/clinical/` (45+ rules, all DRAFT)
- [x] Phase 3 schema + additive migration `20261221000000_activity_safety_v1` (9 models; Recipe drift excluded; `activitySafetyRule` accessor verified)
- [x] Phase 4 deterministic engine: `src/services/activitySafety/{constants,activityCatalog,environment,engine,context,index}.js` — multi-dimensional (medical/functional/environmental/personalization), structural safeguards always-on
- [x] Phase 5 rule registry: `rulesData.js` (71 rules seeded DRAFT via `scripts/seed-activity-safety-rules.js --apply`)
- [x] Phase 6 env service: `src/services/environmentService.js` — normalized Open-Meteo v2 (feels-like, humidity, wind/gusts, UV forecast, 12h window) + US AQI feed; `alertsAvailable:false` honest; stale marking
- [x] Routes: `/activity-safety/*` (recommendation, evaluate, symptoms, injuries, feedback, profile) + `GET /weather/environment` — all behind server flags
- [x] Phase 8 wiring: `/activity-safety/*` routes, voice REPORT_INJURY/REPORT_SYMPTOM + START_WORKOUT pre-check, todayActions safety_check gate, workout/movement reminder suppression on urgent symptoms, mobile dashboard suggestion path behind `healthAwareRecommendations`
- [x] Dead-path honesty: `weatherAdjusted` flag; `/summary/daily` wording fixed; `healthScoreEngine` "aim for" nudges removed
- [x] **Shared safety gate** `src/services/activitySafety/gate.js` — every remaining producer routed through it:
  - `progressCoach` — COMPLETE_WORKOUT opportunities filtered when `activityPushOk===false`
  - `weeklyHealthReview` — "start a workout" copy suppressed unless `activityPushOk`
  - `sleepRecovery` — `lighter_intensity` → `rest` overlay on suppressed gate
  - `workoutPlanner`/`personalPlans` — draft/edit/confirm/catalog + progression suggestions consume `deriveLimitations` + `blockedCategories` (server-derived from injuries/surgeries/restrictions — never user-supplied alone); `urgent` → 422 refuse
  - `workoutProgression` — increase suggestions coerced to `review` when current restrictions conflict
  - `trainerCopilot` — privacy-preserving `safety_notice` draft + presence-only flag (no medical detail without consent)
  - `trainerPlanService` — `assign` + `getForClient` annotate `safetyConflicts` per exercise
  - `formChecks` — `clientSafetyNotice` on requests targeting restricted members
  - `chat`/`aiService` — post-generation `ACTIVITY_SUGGESTION_RE` validation deflects unsafe exercise pushes when gate suppresses
- [x] `group_indoor` gap closed — `GROUP_INDOOR` constant + `group_fitness_class` catalog entry with real demands (weight-bearing, impact, balance) — indoor≠safe verified by tests
- [x] Shadow-mode diff job `scripts/activity-safety-shadow-diff.js` — live (APPROVED-only) vs shadow (incl. DRAFT) per candidate; privacy-preserving summary (ids+decision codes+rule codes only); flag-off skips; shadow rows persist only with `shadow:true`
- [x] Mobile reporting/feedback UI — `SafetyReportScreen` (injury form + symptom chips with backend codes), `SafetyFeedbackScreen` (verdict vocabulary), `safetyInvalidation` bus, Dashboard entry points; gated on `activitySafetyEngine` (mobile `f5fa88d`)
- [x] Scenario expansion — 40-combination matrix (S021–S060): medical×injury×environment×missing-data
- [x] Cross-file env-leak hardening — confirmed `process.env` is shared across jest files under `--runInBand` + sequencer reordering → made every env mutator exception-safe (messaging afterAll restore, featureFlags.test provider restore, photoScan/trainerWorkoutPlans try/finally, energySummary restore-not-delete)
- [x] **Eligibility audit** — `seated_movement` gained `upper_limb_load`/`trunk_load` (restrictable via documented prohibitions — chair work still loads arms/trunk); `rest` removed from the suggestion slot (`no_safe_candidate` + `restFallback` marker — never "suggestion: rest")
- [x] **Clinical review package** `scripts/activity-safety-review-package.js` → `docs/clinical/activity-safety-review-package.md` + `tests/activitySafety.reviewPackage.test.js` (71 executable examples): per-rule triggers, token reachability, affected activities, co-firing conflicts, uncertainty. Findings: 4 URGENT rules are structural mirrors; 22 inert as encoded (wildcards, unreachable profileFlags, non-canonical symptom codes, uncovered catalog categories)
- [x] **NWS severe-weather alerts** — `api.weather.gov/alerts/active?point=` live-verified: NYC→`nws-us`+real alert, MexicoCity→4xx→`unsupported`, Paris→`unsupported`, outage→`unavailable`+`alertsAvailable:false`
- [x] **Merge tie-break fix** — `DEFER_OUTDOOR`(3.5)>`MODIFY`(3), `BLOCK`(5.5)>`NEEDS_CLINICAL_REVIEW`(5): equal-rank ties could silently downgrade env deferrals to "modify" and documented blocks to "review" (found by shadow report)
- [x] **Shadow disagreement report** `scripts/activity-safety-shadow-report.js` → `docs/audits/activity-safety-shadow-report.md`: 32 scenarios × 13 activities, post-fix **39 disagreements, all stricter, 0 LOOSER**
- [x] **Privacy fix T-1** — trainer `assign` response leaked `blockedCategories`/`limitationConflict`; `planSafetyConflicts` `detail:'summary'` strips them (no consent scope exists for clinical detail; client view keeps `detail:'full'`)
- [x] **Security/privacy review** → `docs/audits/activity-safety-security-privacy.md` (access matrix verified; P-1 retention, P-2 consent gap, P-3 dead consentScopes, P-4 emergency copy, P-5 free-text latent)
- [x] **Staging runbook** → `docs/deployment/activity-safety-staging-runbook.md` (flag order, 9 synthetic personas, validation steps, rollback)
- [x] **Stateful E2E** `tests/activitySafety.e2e.test.js` — in-memory store behind prisma mock; injury→restriction→suppression→recovery full loop through real route handlers (3 tests)

## In progress
- Phase 14 final validation doc — release blockers truthfully remain (see §16)

## Next exact task
Clinical review queue execution (external gate), real alert provider integration, staging deploy evidence.

## Files modified (mine only, all sessions)
- `src/services/activitySafety/*` (constants, activityCatalog, environment, engine, context, index, rulesData, gate)
- `src/services/environmentService.js`, `src/services/photoRecipeMatcher.js`
- `src/routes/activitySafety.js` (new), `src/routes/weather.js`, `src/routes/index.js`, `src/routes/voice.js`, `src/routes/chat.js`, `src/routes/personalPlans.js`
- `src/services/voice/voiceParser.js`, `src/services/todayActions.js`, `src/services/reminders/scheduler.js`
- `src/services/summaryService.js`, `src/services/recommendationEngine.js`, `src/services/healthScoreEngine.js`
- `src/services/progressCoach.js`, `src/services/weeklyHealthReview.js`, `src/services/sleepRecovery.js`, `src/services/workoutPlanner.js`, `src/services/workoutProgression.js`, `src/services/trainerCopilot.js`, `src/services/trainerPlanService.js`, `src/services/formChecks.js`, `src/services/healthSources.js`
- `src/config/featureRegistry.js` (+4 flags, clientKey fix)
- `prisma/schema.prisma` (+9 models + User relations), `prisma/migrations/20261221000000_activity_safety_v1/`
- `scripts/seed-activity-safety-rules.js`, `scripts/activity-safety-shadow-diff.js`
- `tests/activitySafety.{engine,routes,voice,todayActions,producers,scenarios,shadowDiff,reviewPackage,e2e}.test.js`, `tests/environmentService.test.js`
- `tests/{featureFlags,messaging,photoScan,trainerWorkoutPlans,energySummary}.test.js` (env-leak exception-safety)
- `docs/clinical/*` (evidence register + review queue)
- Mobile: `src/api/activitySafety.ts`, `src/hooks/useSafetyRecommendation.ts`, `src/services/{safetySuggestion,safetyInvalidation}.ts`, `src/screens/{DashboardScreen,SafetyReportScreen,SafetyFeedbackScreen}.tsx`, `src/hooks/useWeather.ts`, `src/config/featureKeys.ts`, `src/navigation/RootNavigator.tsx` + tests

## Tests executed
- `tests/activitySafety.engine.test.js` → **57/57** (S001–S020, env bands, lifecycle, matching, invariants, pipeline)
- `tests/activitySafety.scenarios.test.js` → **40/40** (S021–S060 combination matrix)
- `tests/activitySafety.producers.test.js` → **19/19** (gate dispositions, planner limitation derivation, progressCoach, sleepRecovery overlay, copilot privacy flags, trainerPlan conflicts, formChecks, wearable-recovery≠override)
- `tests/activitySafety.shadowDiff.test.js` → **6/6** (flag-off skip, draft-rule deltas, shadow-only persist, privacy shape)
- `tests/activitySafety.reviewPackage.test.js` → **71/71** (per-rule executable examples incl. proven-inert + structural-mirror cases)
- `tests/environmentService.test.js` → **6/6** (NWS coverage/outage/region honesty + engine end-to-end)
- `tests/activitySafety.e2e.test.js` → **3/3** (stateful full-workflow)
- `tests/activitySafety.routes.test.js` → **17/17**, `tests/activitySafety.voice.test.js` → **17/17**, `tests/activitySafety.todayActions.test.js` → **3/3**
- **Full backend suite: 117 suites / 1435 tests passed** (2 consecutive clean runs post-fix)
- Mobile: **72 suites / 423 tests passed**; `tsc --noEmit` clean; eslint clean

**Total activity-safety coverage: 225 backend + 7 mobile = 232 tests, all passing**

## Failing tests
None from activity-safety work. Pre-existing: `A06` nutrition fixture intentionally red (user WIP).

## Pending migrations
`20261221000000_activity_safety_v1` applied locally (additive, drift-filtered). Production apply pending deploy pipeline.

## Clinical review blockers
- 71 `activitySafetyRule` rows all `reviewStatus=DRAFT` — inert for live users until clinician APPROVED (migration CHECK requires reviewedBy/reviewedAt).
- `docs/clinical/clinical-review-queue.md` lists the high-risk cases requiring qualified review before activation.

## Known limitations (as of this checkpoint)
- `alertsCoverage` is US + territories (NWS) only — live-verified; elsewhere returns honest `unsupported`/`unavailable`, never "no alerts".
- UV pulled from nearest forecast hour (free tier has no current UV).
- `isEvaluationFresh` implemented but no consumer recommendation-cache yet (evaluations compute fresh every call).
- Mobile local weather buckets remain the offline fallback when backend path disabled — explicitly documented as fallback, not a bypass (restrictions only apply when backend reachable).
- `rest` is never in the suggestion slot — reported as `restFallback` (non-exercise fallback). `seated_movement` is restrictable via `upper_limb_load`/`trunk_load` prohibitions.
- Cross-file `process.env` mutation under `--runInBand` remains a test-hygiene risk by design — all currently-known mutators are exception-safe; new tests must restore env in `finally`/`afterAll`.

## Commit IDs
- `359648e` Phase 1 inventory + progress tracking
- `9eb0bdd` schema + engine + env service + routes + rules + 57 tests
- `a816447` routes + voice capture + dead-path honesty fixes (+34 tests)
- `bbbc763` shared safety gate integration across remaining producers
- `9ed1eac` push-vs-suggestion semantics + producer/shadow/scenario suites (+65 tests)
- `cacc614` weather clientKey digit fix · `b1b2a63` photoRecipeMatcher unordered-take bug
- Mobile `7d4c3d1` health-aware suggestion path · `44269a9` flag key fix · `f5fa88d` report/feedback screens + invalidation bus (mobile repo, main branch)
- `4f85cbd` seated_movement restrictable + rest-as-fallback · `4ec5c79` clinical review package + 71 executable examples
- `978fd93` NWS alerts live-integration · `b1889f8` stateful E2E · `9a58c4f` merge tie-break fix + shadow disagreement report (0 LOOSER)
