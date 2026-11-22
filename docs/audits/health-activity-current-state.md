# Health-Aware Activity & Weather — Current-State Inventory

**Date:** 2026-11-21 · **Branch:** `feat/activity-safety-engine` · **Method:** direct code inspection of `fitness-app-backend`, `fitness-app-mobile`, `fitness-app-web`; prior audit at `fitness-app-mobile/docs/audits/weather-recommendation-audit.md` verified against code.

Program docs live in **this repo** (`docs/`) because the engine, schema, rules and flags are backend artifacts. Mobile consumers are documented here but implemented in the mobile repo.

---

## 1. Recommendation producers — every path that suggests activity

| # | Producer | File / function | Inputs | DB / API deps | Client consumer | Test coverage | Actually executes? | Safety gaps |
|---|---|---|---|---|---|---|---|---|
| P1 | Weather suggestion | `fitness-app-mobile/src/services/weatherContext.ts:16` `weatherSuggestion()` | `tempC`, `condition==='rainy'`, `workoutPlanned`, `restDay` (local `progressPrefs`) | none (pure fn) | `DashboardScreen.tsx:174–224` | `weatherContext.test.ts` 10 tests | ✅ yes — the only weather-aware suggestion users see | raw temp only; no feels-like/humidity/wind/AQI/UV/alerts; no health data; ≥28–31.9 °C reads "comfortable" (backend `hot` vs mobile `VERY_HOT_C=32` mismatch); cold 1–10 °C reads "comfortable"; thunderstorm = drizzle |
| P2 | Balance recommendation | `src/services/recommendationEngine.js:12` `recommendFromBalance()` | calorie surplus, `mealsLogged`, `weather.condition` | none | `/recommendations` (`src/routes/recommendations.js:20`), `/summary/daily` (`src/routes/summary.js:9`) | `tests/recommendationEngine.test.js` — weather test is a tautology | ⚠️ executes but `applyWeather` (`:101`) is **dead** — no base rec emits `location:'outdoor'` or `type:'workout'`; verified by direct invocation (all 5 surplus tiers × 4 conditions identical) | weather never affects output; no health/restriction inputs; mobile `RecommendationType` union stale |
| P3 | Daily summary insight | `src/services/summaryService.js:46` `buildInsight()` | meals, balance, rec, `weather.condition` | none | `/summary/daily` — **no caller** (`src/api/summary.ts` unused in mobile; web has none) | `summaryService.test.js` mentions weather | ⚠️ reachable via API, unused by clients | line `:70` claims "the plan accounts for it" — false; echoes unvalidated `weather.condition` string |
| P4 | Health Priorities actions | `src/services/todayActions.js` `ACTION_DEFS` (`start_workout` :35, `recovery_lighter` :57…) | sleep recovery, trainer plan, habits, check-in window | prisma (many models) | `TodayActionsCard` mobile; flag `health_priorities` | `tests/todayActions*` | ✅ yes when flag on | no injury/condition/weather inputs — can push "Continue your workout plan" during thunderstorm or with an ankle fracture |
| P5 | Progress coach | `src/services/progressCoach.js` | component timing scores | prisma | `ProgressCoachCard`; flag `progressCoach`/`leoProgressEnabled` | yes | ✅ yes | activity timing hints only; no safety eval |
| P6 | Weekly health review | `src/services/weeklyHealthReview.js:127–141` | sessions, check-ins, mind | prisma | `WeeklyReview` screen; flag `weekly_health_review_enabled` | yes | ✅ | suggests "one workout" — no restriction check |
| P7 | Personal workout plans | `src/routes/personalPlans.js:15` POST `/personal-plans/draft` | profile | AI (OpenAI) | mobile; flag `ai_workout_recommendations` | yes | ✅ flag-gated AI | AI-generated plan — no safety-engine validation before presentation |
| P8 | Trainer workout plans | `src/routes/trainerWorkoutPlans.js`, `myWorkoutPlans.js` | coach-authored plans | prisma | `MyWorkoutPlans`; flags `trainer_workout_plans_enabled` | yes | ✅ | human-authored — clinician-adjacent but no automated restriction check |
| P9 | Voice assistant | `src/routes/voice.js` intents | transcript → `VOICE_INTENTS` | prisma + OpenAI | mobile; flags `voice_*_logging` | yes | ✅ | `START_WORKOUT`/`LOG_EXERCISE_SET` — no injury-report intent, no safety check before START_WORKOUT |
| P10 | Leo chat | `src/routes/chat.js` | message | OpenAI | mobile; flag `ai_coach` | yes | ✅ | free-form AI text could suggest activity — no output validator vs restrictions |
| P11 | Reminder nudges | `src/services/reminders/` (`learning.js`, `scheduler.js`) | schedules, prefs | prisma | push notifications | extensive | ✅ | time suggestions only; categories include workout — no safety suppression when restriction added |
| P12 | Suggest meals | `src/routes/recommendations.js:65` `/recommendations/suggest` | occasion, cuisines | prisma + `suggestMeals` | `Suggest` screen | yes | ✅ | nutrition path — already enforces `ConditionRule reviewStatus='APPROVED'` gating (precedent to mirror) |

## 2. Relevant existing models (do NOT duplicate)

| Model | Purpose | Gaps for activity safety |
|---|---|---|
| `UserHealthProfile` (`schema.prisma:62`) | smoker/alcohol/sleepGoal/waterGoal/notes | no injury, mobility, pregnancy, medication fields |
| `HealthCondition` + `UserHealthCondition` (`:81`, `:94`) | named condition, `severity`, `active` | condition only — no applicability to activity; `UserHealthCondition` has no onset/status detail, no provenance/consent |
| `ConditionRule` (`:660`) | condition→ingredient/supplement rules | `target` is `ingredient`/`supplement`/`clinical_ingredient` — not activity; **review-gating fields exist and are the pattern to mirror** (`ruleCode`, `clinicalAction`, `clinicalSeverity`, `applicabilityCriteria`, `requiresPersonalization`, `evidenceSourceId`, `reviewStatus`, `version`, `reviewedBy`, `reviewedAt`) |
| `RuleEvidence` (`:1903`) | citations for rules | reusable as evidence store for activity rules |
| `ClinicalRuleReview` enum (`:1890`) | `DRAFT`/`REVIEWED`/`APPROVED` | reusable |
| `Exercise` + `ExerciseMuscle` (`:2137`, `:2157`) | 800+ exercise library: `level`, `force`, `mechanic`, `equipment`, `appEquipment[]`, `category`, muscles primary/secondary | no body-region/weight-bearing/impact/balance/exertion metadata for safety eval — needs a demand-profile layer, not schema change to library |
| `WorkoutSession` + `ExerciseSet` (`:224`, `:253`) | logged workouts | usable as recent-activity context |
| `HealthEnergyRecord`, `WearableDevice`, `HealthMeasurement`, `HealthMetricSummary` (`:2103`, `:3394+`) | wearable data | usable as recovery context (estimates, never clearance) |
| `ScenarioDefinition` (`:3869`) | `id`, `category`, `priority`, `expected`, `data`, `reviewStatus` | exists for nutrition 120-scenario registry; activity-safety scenarios can share the model or a parallel data file |
| `BaselineAssessment` (`:3111`) | trainer intake data (Json) | potential clinician-restriction source — review |
| `UserPlanningPreferences` (`:1418`) | goal/activity prefs | feeds personalization |
| `UserEvent`, `AuditLog`, `SafetyAuditLog` (`:426`, `:1298`, `:783`) | event/audit trail | `SafetyAuditLog` exists for supplement-safety audits — evaluate reuse vs dedicated evaluation log |

## 3. Missing models (must add)

- User injuries (type, body part, laterality, status, restrictions, reassessment).
- User activity restrictions (clinician- or self-reported: prohibited categories, weight-bearing, ROM).
- Symptom reports (structured, red-flag detection, escalation).
- Activity safety rules (versioned, evidence-linked, review-gated — mirror `ConditionRule`).
- Activity safety evaluations (decision provenance + expiry).
- Environmental observations (normalized weather/AQI/alerts with freshness).
- Medication-activity flags (opt-in; no med list exists — `Supplement`/`UserSupplement` only).
- Mobility/accessibility profile (walking ability, aids, wheelchair, balance, standing tolerance).
- Pregnancy/postpartum status (voluntary, never inferred).

## 4. Feature-flag infrastructure

- `src/config/featureRegistry.js` — central registry (snake_case keys, `clientKey` camelCase, class/group/default/failOpen/dependsOn/endpoints). `requireFeature(key)` middleware (`src/middleware/requireFeature.js`) + `flags.isEnabled(key, userId)` service (`src/services/featureFlags/service.js`). PostHog provider with env `FF_*` overrides; `FF_CACHE_TTL_MS`.
- Mobile mirror: `fitness-app-mobile/src/config/featureKeys.ts` — must add client keys.
- Existing related flags: `scenario_engine` (120-scenario engine), `symptom_pathways` (symptom escalation — **registered but no routes implement it yet**), `health_priorities`, `ai_coach`, `ai_workout_recommendations`.
- New flags needed per Phase 12: `activity_safety_engine_enabled`, `weather_intelligence_v2_enabled`, `health_aware_recommendations_enabled`, `activity_safety_shadow_mode`, `clinical_rule_set_version` (as config, not boolean).

## 5. Clinical rule gating precedent (must mirror exactly)

- `ConditionRule`/`HealthConditionNutrientRule` consumers filter `reviewStatus:'APPROVED'` at query level (`mealSuggestion.js`, `healthScoreEngine.js`, `safety/*Validator.js`, `weeklyDietGenerator.js`, `conditionEvaluation`).
- DB CHECK constraint requires `reviewedBy`+`reviewedAt`+`evidenceSourceId`+`clinicalAction` on APPROVED rows — approvals can't be written silently.
- `scripts/verify-rule-gating.js` — read-only proof that DRAFT rules are inert across every consumer; write an activity-safety twin.
- `docs/nutrition-intelligence/EVIDENCE_REGISTER.md` + `CLINICAL_RULE_REVIEW_QUEUE.md` — doc formats to mirror in `docs/clinical/`.

## 6. Weather integration (verified in prior audit — confirmed unchanged)

- Open-Meteo only; `weatherService.js` requests `temperature_2m,precipitation,weather_code`; 3 buckets; no backend cache; no AQI/UV/feels-like/wind/alerts; geocode endpoint for saved city; auth + verified-email + 120/min per-user; 30-min AsyncStorage cache on mobile; stale → suggestion suppressed.

## 7. Nutrition-side infrastructure reusable by this program

- `data/scenarioRegistry.json` (120 scenarios, `expectedVerbatim` authoritative), `data/scenarioFixtures.json` + `tests/scenarioFixtures.test.js` (fixture runner executes real engines; `blocked_not_implemented` reported not asserted), `scripts/build-scenario-fixtures.js`, `scripts/scenario-matrix.js`, `scripts/seed-scenarios.js`.
- `src/services/decisionEngine.js` — deterministic outcome resolver (`ESCALATION → WARNING → REVIEW → ASK → FEEDBACK`) for nutrition scenarios. Outcome vocabulary precedent; activity engine needs multi-dimensional variant (medical/functional/environmental/personalization → disposition) per spec.
- `src/services/calorieSafety.js` (uncommitted, user's WIP) — floor/safety logic for nutrition; do not disturb.

## 8. Entry points to wire in Phase 8 (verified)

| Entry point | Today | Action |
|---|---|---|
| Dashboard weather line + suggestion | `weatherContext` local rules | Route through engine behind `weather_intelligence_v2_enabled`; local rules remain offline fallback |
| `/recommendations?weather=` | dead `applyWeather` | Either implement real workout-type recs or remove param + misleading plumbing |
| `/summary/daily` insight | false "accounts for it" | Only claim when evaluation ran; else drop the sentence |
| `todayActions` `start_workout` | no safety check | Suppress/annotate via engine when flag on |
| Voice `START_WORKOUT` | direct action | Pre-action safety check when restriction data exists (future); injury-report intent |
| Push workout reminders | time-based | Suppression hook when hard restriction active |
| Trainer plans | human-authored | Surface restriction flags to coach UX (later) |
| Web app | none | no weather/recs UI — confirm before building any web surface |

## 9. Uncommitted work on this branch (do not disturb / do not commit)

User WIP from the nutrition workstream: `src/services/scoringV2.js` (dps-v2.1), `src/services/decisionEngine.js`, `src/services/calorieSafety.js`, `data/scenarioFixtures.json`, `data/scenarioAppendixA.json`, `docs/nutrition-intelligence/**`, `tests/scenarioFixtures.test.js`, `tests/calorieSafety.test.js`, `tests/score*.test.js`, several `scripts/*`, `prisma/seed-foods.js`, `src/routes/{dailyProgress,profile}.js`, `src/services/{calorieEngine,energySummary,healthScoreEngine,mealSuggestion,weeklyDietGenerator}.js`, `src/services/safety/*Validator.js`, `tests/{calorieEngine,healthScore,mealSuggest}.test.js`. Checkpoint commits must stage only activity-safety files.

## 10. Inventory verdict

- **Implemented & live:** weather fetch/display, mobile weather suggestion (shallow), health priorities, trainer plans, wearable sync, supplement safety gating.
- **Implemented but dead/disconnected:** `applyWeather`, `/recommendations?weather=`, `/summary/daily` weather field, `api/recommendations.ts`, `api/summary.ts`, `symptom_pathways` flag (no routes).
- **Partially implemented:** scenario engine (nutrition-only today), clinical rule gating (nutrition/supplement only).
- **Missing:** injuries, activity restrictions, symptom reports, mobility profile, pregnancy status, medication-activity flags, activity demand profiles, normalized environmental observations, the safety engine itself, evaluation persistence, output validation for AI paths.
