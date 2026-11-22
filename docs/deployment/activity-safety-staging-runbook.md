# Activity Safety — Staging Validation Runbook

**Purpose:** validate the activity-safety engine + weather intelligence on a
staging environment using **synthetic test accounts only**. No real user data,
no clinical claim — all 71 rules remain `DRAFT` regardless of staging results.

## 0. What ships

| Component | Artifact |
|---|---|
| Schema (already applied locally) | `prisma/migrations` — UserInjury, UserSurgery, UserActivityRestriction, UserSymptomReport, ActivitySafetyRule, ActivitySafetyEvaluation, ActivitySafetyFeedback, UserActivityProfile |
| Engine + gate | `src/services/activitySafety/*` |
| Producers | personalPlans, workoutPlanner, progressCoach, weeklyHealthReview, sleepRecovery, trainerCopilot, trainerPlanService, formChecks, chat, todayActions, reminders, voice |
| Env service | `src/services/environmentService.js` — Open-Meteo forecast + AQI, NWS alerts (US + territories) |
| Routes | `/activity-safety/*`, `/weather/environment` |
| Seed | `node scripts/seed-activity-safety-rules.js` (all DRAFT) |

## 1. Pre-flight

```bash
npx prisma validate
npx prisma migrate status   # additive only — never migrate dev/reset on staging
npm test                    # full suite must be green first
```

## 2. Flag rollout order (server-enforced, each off-by-default)

Enable **one at a time**, verify, then proceed:

| Order | Flag | Scope after enabling | Verify |
|---|---|---|---|
| 1 | `activity_safety_engine` | evaluation APIs only — no user-facing suggestions change (recommendation output needs flag 4) | `POST /activity-safety/evaluate` 200 on synthetic user |
| 2 | `weather_intelligence_v2` | `/weather/environment` | call returns `alertsCoverage` field (`nws-us`/`unsupported`/`unavailable`) |
| 3 | `activity_safety_shadow_mode` | shadow evaluations only — internal | `node scripts/activity-safety-shadow-diff.js --user=<syn>` prints ids/codes only |
| 4 | `health_aware_recommendations` | user-facing `/recommendation` + mobile safety suggestion | synthetic restricted user → non-conflicting suggestion or no suggestion |

**Rollback = reverse order, flags off.** No data loss: injuries/symptoms/
restrictions persist; recommendations simply stop reading them. Additive
migration needs no rollback.

## 3. Synthetic test accounts (never real users)

| Account | Seed state | Expected |
|---|---|---|
| `syn-healthy` | profile complete, no injuries | suggestion from catalog |
| `syn-nwb` | current ankle fracture, `non_weight_bearing` | outdoor_walk/run/indoor_walk BLOCK; suggestion never weight-bearing |
| `syn-surgery` | recovering orthopedic, empty `activityClearance` | non-light activities → NEEDS_CLINICAL_REVIEW |
| `syn-asthma` | asthma condition | AQI≥101 → outdoor deferral |
| `syn-fever` | active fever symptom | review-level + MODIFY behavior |
| `syn-urgent` | reported `chest_pain` | suppressed_urgent everywhere |
| `syn-blanket` | restriction covering all load categories + regions | `no_safe_candidate` + `restFallback` (never "suggestion: rest") |
| `syn-missing` | age 70, `profilePresent:false` | INSUFFICIENT_DATA / requiredData prompts |
| `syn-trainer` + `syn-client` | client has category prohibition | assign → `safetyConflicts` conflict flags WITHOUT category tokens (privacy) |

## 4. Validation steps on staging

1. **Smoke:** `GET /activity-safety/profile` per synthetic account → reflects seeded state.
2. **Workflow suite locally first:** `npx jest tests/activitySafety.e2e.test.js --runInBand` (stateful happy-path).
3. **NWS probe (real call):** `node -e "require('./src/services/environmentService').fetchEnvironment(40.7,-74).then(o=>console.log(o.alertsCoverage))"` → `nws-us`. Paris `(48.85,2.35)` → `unsupported`.
4. **Shadow diff:** `node scripts/activity-safety-shadow-diff.js --recent=5 --json` → ids/codes only in output; verify no reason/injury text.
5. **Shadow matrix:** `node scripts/activity-safety-shadow-report.js` → regenerate `docs/audits/activity-safety-shadow-report.md`; confirm zero LOOSER rows.
6. **Producer spot-checks:** progressCoach COMPLETE_WORKOUT suppressed for `syn-nwb`; trainer assign shows conflict flags; chat exercise-push replaced by deflection copy for `syn-urgent`.
7. **Push-notification check:** no notification may carry symptom/injury/condition text — verify inbox bodies on synthetic accounts.

## 5. What staging does NOT prove

- Clinical correctness of any rule (requires qualified review — see `docs/clinical/`).
- Non-US alert coverage (NWS is US + territories only — `alertsCoverage` is honest elsewhere).
- Mobile rollout (flags remain off until gates pass).
- Load/latency characteristics at production scale.
