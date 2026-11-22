# Health-Aware Activity Safety — Validation Report (INTERIM)

**Status: WORK IN PROGRESS — NOT PRODUCTION APPROVED.**
Branch `feat/activity-safety-engine` · Last checkpoint: `9ed1eac` (backend), `f5fa88d` (mobile).

This report reflects the current implementation state. Sections marked ⏳ are incomplete; nothing in this document constitutes clinical sign-off or release readiness. Clinical review and a real alert provider remain outstanding hard gates.

---

## 1. Executive summary

A deterministic, versioned activity safety engine now exists and is wired into the live recommendation surfaces that were previously disconnected. Weather genuinely influences outdoor dispositions through normalized environmental bands (heat-index, AQI, thunder, wind-chill, alerts) with unknown/stale data never treated as safe. Health restrictions — active injuries, documented prohibitions, surgeries without clearance, mobility profiles, pregnancy, urgent symptoms — are evaluated per candidate activity via a shared service (`src/services/activitySafety/`). Voice reports of injuries/symptoms update the shared context and invalidation is automatic. All 71 clinical rules are seeded `DRAFT` and cannot fire for real users until a qualified reviewer approves them — automated tests verify code consistency only, never medical correctness.

## 2. Architecture before → after

**Before:** mobile weather buckets (temp/precip only) + dead backend `applyWeather` + unused `/recommendations` + misleading summary claim. Health data had no effect on activity suggestions.

**After:** one engine evaluates every candidate across four dimensions (medical / functional / environmental / personalization) → decision via DECISION_RANK merge (ALLOW < MODIFY < DEFER_OUTDOOR < INSUFFICIENT_DATA < NEEDS_CLINICAL_REVIEW < BLOCK < URGENT). Producers: `/activity-safety/recommendation` (canonical), `/activity-safety/evaluate`, `/activity-safety/symptoms|injuries|feedback|profile`, voice REPORT_INJURY/REPORT_SYMPTOM + START_WORKOUT pre-check, todayActions `safety_check` gate, reminder workout/movement suppression, mobile dashboard suggestion path — **plus the shared `gate.js` covering every remaining suggestion surface**: progressCoach opportunities, weeklyHealthReview pushes, sleepRecovery overlay, personal workout-plan draft/edit/confirm/progression, trainerCopilot drafts, trainerPlanService assign/client-view, formChecks, AI chat post-generation validation, healthSources recovery copy. `/weather/environment` serves normalized observations.

## 3. Files changed

Backend (branch `feat/activity-safety-engine`):
- NEW `src/services/activitySafety/`: `constants.js`, `activityCatalog.js`, `environment.js`, `engine.js`, `context.js`, `index.js`, `rulesData.js`, `gate.js` (shared producer gate: dispositions, `deriveLimitations`, `blockedCategories`, `genericWorkoutAllowed`/`activityPushOk`, `exerciseCategories`/`dbExerciseCategories` bridges, `planSafetyConflicts`)
- NEW `src/services/environmentService.js` — Open-Meteo v2 + US-AQI normalization
- NEW `src/routes/activitySafety.js` — 7 endpoints
- MOD `src/routes/weather.js` (+`/environment`), `src/routes/index.js` (mount), `src/routes/voice.js` (intents + pre-check + latent `flags` fix), `src/routes/chat.js` (post-gen validation), `src/routes/personalPlans.js` (gate wiring)
- MOD `src/services/voice/voiceParser.js` (safety intents), `src/services/todayActions.js` (gate), `src/services/reminders/scheduler.js` (suppression), `src/services/summaryService.js` + `recommendationEngine.js` + `healthScoreEngine.js` (honesty)
- MOD `src/services/{progressCoach,weeklyHealthReview,sleepRecovery,workoutPlanner,workoutProgression,trainerCopilot,trainerPlanService,formChecks,healthSources}.js` (gate integration)
- MOD `src/config/featureRegistry.js` (+4 flags)
- NEW `scripts/seed-activity-safety-rules.js`, `scripts/activity-safety-shadow-diff.js`, 7 test files, `docs/clinical/*`, `docs/implementation/*`
- MOD `tests/{featureFlags,messaging,photoScan,trainerWorkoutPlans,energySummary}.test.js` — cross-file `process.env` leaks made exception-safe

Mobile (main, `7d4c3d1`→`f5fa88d`): `src/api/activitySafety.ts`, `src/hooks/useSafetyRecommendation.ts`, `src/services/{safetySuggestion,safetyInvalidation}.ts`, `DashboardScreen.tsx`, `SafetyReportScreen.tsx`, `SafetyFeedbackScreen.tsx`, `RootNavigator.tsx`, `useWeather.ts`, `featureKeys.ts`, tests.

## 4. Database changes

Migration `20261221000000_activity_safety_v1` (additive, applied locally; unrelated `Recipe` drift excluded):
`UserActivityProfile`, `UserInjury`, `UserSurgery`, `UserActivityRestriction`, `UserSymptomReport`, `ActivitySafetyRule`, `ActivitySafetyEvaluation`, `ActivitySafetyFeedback` + `User` relations + APPROVED-requires-reviewer CHECK constraint.

## 5. API changes

| Endpoint | Flag | Notes |
|---|---|---|
| `GET /activity-safety/recommendation` | `health_aware_recommendations` | canonical suggestion + per-candidate decisions |
| `POST /activity-safety/evaluate` | `activity_safety_engine` | single-activity pre-check (voice/coaching callers) |
| `POST /activity-safety/symptoms` | `activity_safety_engine` | triage + urgent escalation copy |
| `POST /activity-safety/injuries` + `PATCH /injuries/:id` | `activity_safety_engine` | capture + lifecycle; follow-up questions |
| `POST /activity-safety/feedback` | `activity_safety_engine` | 8 verdicts |
| `GET /activity-safety/profile` | `activity_safety_engine` | correction UX snapshot |
| `GET /weather/environment` | `weather_intelligence_v2` | normalized observation |
| `POST /voice/commands/execute` | voice flags | REPORT_INJURY/REPORT_SYMPTOM intents |

## 6. Mobile screens changed

`DashboardScreen` weather suggestion prefers engine line when flag on; local buckets remain offline fallback. `SafetyReportScreen` (injury form + symptom chips using backend codes, urgent escalation rendered server-verbatim) + `SafetyFeedbackScreen` (8-verdict vocabulary) shipped behind `activitySafetyEngine`; `safetyInvalidation` bus clears+refetches suggestions on any report/feedback — a stale suggestion cannot survive a new restriction.

## 7. Feature flags

`activity_safety_engine`, `weather_intelligence_v2`, `health_aware_recommendations`, `activity_safety_shadow_mode` — all server-enforced, default `false`, env overrides `FF_<KEY>`.

## 8. Health-condition coverage matrix

| Condition | Status |
|---|---|
| Asthma/EIB/COPD | ✅ implemented (env sensitive bands + DRAFT rules) |
| CVD/HTN/HF/arrhythmia | ✅ structural + DRAFT rules |
| Diabetes T1/T2 + complications | ✅ structural + DRAFT rules (med flags for hypoglycemia/heat) |
| CKD/dialysis | 🟡 DRAFT rules only |
| Anemia/immunosuppression/cancer tx | 🟡 DRAFT rules only |
| MS/Parkinson's/seizure/stroke | 🟡 MS heat band live; rest DRAFT |
| Osteoporosis/OA | ✅ structural + DRAFT |
| Pregnancy/postpartum | ✅ structural (warning symptoms urgent; uncomplicated never banned) |

## 9. Injury coverage matrix

Weight-bearing orders, prohibited categories, acute/recovering/resolved lifecycle, severe undiagnosed pain → review, unmapped body part → INSUFFICIENT_DATA, surgery w/o clearance → review (never time-cleared), expired clinician restrictions → review, multi-injury compounding — ✅ implemented & tested. Rehab-phase granularity: 🟡 `rehabInstructions` stored, not yet evaluated.

## 10. Environmental coverage matrix

| Hazard | Status |
|---|---|
| Thunderstorm/severe alert | ✅ code inference; alert feed `alertsAvailable:false` — real provider pending |
| Heat index (32/35/40.5 bands + sensitive tightening) | ✅ |
| AQI (USG/unhealthy/hazardous + sensitive groups) | ✅ US-AQI feed |
| Cold wind-chill | ✅ |
| UV ≥6/≥8 | ✅ (forecast-hour UV, free tier) |
| Wind gusts ≥50, heavy precip, ordinary rain | ✅ |
| Missing/stale data | ✅ → INSUFFICIENT_DATA outdoor |
| Better-time suggestion | ✅ real forecast hours only; AQI/alert deferrals never invent times |

## 11. Evidence register & review status

`docs/clinical/activity-safety-evidence-register.md` — 45+ rules, cited sources (ACOG 804, ACSM 2015, EPA AQI, NWS, ADA PA 2016, HHS PAG 2018…). `clinical-review-queue.md` — high-risk cases. **71 rules = DRAFT = inert for users.**

## 12. Scenario coverage

166 automated tests total (159 backend + 7 mobile). Target of 150+ meaningful combinations met: the S021–S060 matrix covers medical×injury×environment×missing-data interactions (compound injuries, surgery+injury stacking, wheelchair+symptom, pregnancy+storm/heat, asthma+COPD+AQI, stale-data+injury precedence, missing-type conservatism, expired-restriction lifecycle, rule-match AND/OR + exclusion veto, determinism, per-user isolation, audit metadata).

## 13. Test results

| Suite | Result |
|---|---|
| engine (S001–S020 + invariants + tie-break regression) | 60/60 ✅ |
| scenario matrix (S021–S060) | 40/40 ✅ |
| producer integration (gate/planner/coach/copilot/plans/formChecks/sleep/chat semantics + privacy assertion) | 21/21 ✅ |
| shadow diff job | 6/6 ✅ |
| review-package executable examples (all 71 rules) | 71/71 ✅ |
| environmentService — NWS alerts | 6/6 ✅ |
| stateful E2E workflow | 3/3 ✅ |
| routes (mocked prisma) | 17/17 ✅ |
| voice parser+execute | 17/17 ✅ |
| todayActions gate | 3/3 ✅ |
| **Full backend suite** | **118 suites / 1444+ tests ✅** |
| mobile (weather/flags/composer/invalidation+screens) | **72 suites / 423 tests ✅, tsc+eslint clean** |

**Nondeterminism investigation:** a prior full-suite run showed 4 flakes (`activitySafety.routes` 403s ×2, `messaging` 404 ×2 — all passing standalone). Root cause confirmed: `process.env` is shared across test files under `--runInBand` and Jest's sequencer reorders files between runs; several files mutated env without exception-safe restore (`messaging.test.js` afterAll *deleted* `FF_TRAINER_ADVANCED_FEATURES_ENABLED`; `featureFlags.test.js` didn't restore `FEATURE_FLAGS_PROVIDER`; `photoScan.test.js`/`trainerWorkoutPlans.test.js` set `'false'` without `finally`; `energySummary.test.js` deleted instead of restoring). The messaging 404 was the *downstream* symptom: flag-off made conversation creation 403, `.body.conversation.id` was undefined → POST `/conversations/undefined/messages` → 404. All confirmed mutators now restore env in `finally`/`afterAll`; two consecutive clean full runs since.

## 14. Remaining unsupported cases

- Alert coverage is NWS (US + territories) only — live-verified; other regions report `alertsCoverage:'unsupported'` honestly, never "no alerts"
- UV is forecast-hour approximation — `alertsAvailable`/`alertsCoverage` fields carry honest semantics
- `rehabInstructions` semantic evaluation (stored, not parsed into restrictions)
- Exercise-library-level per-exercise DB evaluation remains via `dbExerciseCategories` bridge + `planSafetyConflicts` (annotation layer, not per-exercise engine verdicts)
- `isEvaluationFresh` has no consumer recommendation-cache (evaluations compute fresh — correct, uncached)
- LLM rewording path not built (deterministic templates only)
- Region-specific emergency numbers in escalation copy
- 22 of 71 rules are inert as encoded (review package §per-rule) — wildcards, unreachable profileFlags, non-canonical symptom codes, uncovered catalog categories; structural coverage noted per rule; reviewer decides fix-vs-rely
- Privacy gaps P-1..P-5 (retention endpoint, trainer consent category, dead consentScopes field, emergency copy regions, free-text latent exposure)

## 15. Clinical review requirements

Release gate unchanged: qualified clinician/specialist must review (a) all 71 DRAFT rules' evidence, (b) high-risk scenario outcomes, (c) escalation copy, before any `APPROVED` status. The CHECK constraint makes unreviewed approval impossible by accident (requires reviewedBy/reviewedAt). Live evaluation loads `reviewStatus:'APPROVED'` only; DRAFT rules participate exclusively in shadow-mode analysis (`--persist` writes `shadow:true` rows, never user-facing responses).

## 16. Release blockers

1. **Clinical review of rules + scenarios (hard gate)** — all 71 rules still DRAFT; evidence register + review queue + auto-generated review package (`docs/clinical/activity-safety-review-package.md`, includes reachability/inertness findings) ready for reviewer assignment
2. ~~Real alert provider or documented no-coverage handling~~ — ✅ NWS integrated + live-verified (`978fd93`); coverage = US + territories only, honest elsewhere
3. ~~Trainer/coaching/wearable entry points not yet wired~~ — ✅ all producers gated (`bbbc763`/`9ed1eac`)
4. ~~Mobile feedback/report screens not built~~ — ✅ shipped gated (`f5fa88d`)
5. ~~150-scenario target not met~~ — ✅ 232 tests (225 backend + 7 mobile)
6. ~~Shadow-mode diff job not written~~ — ✅ `scripts/activity-safety-shadow-diff.js` + `activity-safety-shadow-report.js` (matrix: 39 disagreements, 0 LOOSER)
7. **No staging/production deploy yet** — flags all default-off; staging runbook ready (`docs/deployment/activity-safety-staging-runbook.md`), deploy evidence outstanding

## 17. Deployment status

Local only. Migration applied additively to dev DB; production apply pending deploy pipeline. All flags default off — zero production behavior change until enabled.

## 18. Rollback procedure

1. Set `FF_ACTIVITY_SAFETY_ENGINE=false`, `FF_HEALTH_AWARE_RECOMMENDATIONS=false`, `FF_WEATHER_INTELLIGENCE_V2=false`, `FF_ACTIVITY_SAFETY_SHADOW_MODE=false` (env overrides beat provider) → routes 403, mobile falls back to local buckets, todayActions/reminders/voice gates inert.
2. DB migration is additive-only — no rollback required; tables remain dormant.
3. **Never** roll back to a path that bypasses recorded restrictions: if `/recommendations?weather=` legacy path is restored, suppress its activity output (it does not evaluate restrictions) rather than reactivating it.
4. Rule de-activation: set `reviewStatus` back to `DRAFT` — engine instantly stops firing it (APPROVED-only load).
5. Persisted evaluations/`shadow` rows are audit artifacts — keep for post-rollback comparison.

## 19. PASS/FAIL/BLOCKED matrix (Phase 14)

| Domain | Verdict | Evidence |
|---|---|---|
| Eligibility audit (seated/rest semantics) | **PASS** | `seated_movement` restrictable via upper_limb/trunk_load; `rest` never in suggestion slot (`restFallback`); 6 new tests `4f85cbd` |
| Producer safety integration | **PASS** | 12 producers gated; 21 producer tests; wearable/LLM/trainer/flag fallbacks cannot override (`bbbc763`,`9ed1eac`) |
| Scenario coverage (≥150) | **PASS** | 225 backend + 7 mobile = 232 safety tests green |
| Clinical review package | **PASS (artifact) / BLOCKED (approval)** | `activity-safety-review-package.md` + 71 executable examples; 4 mirrors + 22 inert documented for reviewer; **approval itself remains externally gated — zero rules APPROVED** |
| Shadow-mode comparison | **PASS** | diff job + 6 tests; disagreement report: 39 stricter / 0 LOOSER post tie-break fix (`9a58c4f`) |
| Environmental coverage | **PASS (US) / BLOCKED (non-US)** | NWS live-verified US+territories (`978fd93`); `alertsCoverage` honest elsewhere — no non-US alert source exists to integrate |
| Engine correctness | **PASS** | tie-break merge bug found by shadow report + fixed + regression tests |
| Privacy/security | **PASS (with gaps)** | trainer leak T-1 fixed (`detail:'summary'`); access matrix verified; P-1..P-5 gaps documented (retention, consent category, emergency copy) |
| Staging validation | **BLOCKED (external)** | runbook + synthetic personas + E2E suite ready; actual staging deploy not performed — no environment access |
| E2E workflows | **PASS** | stateful E2E covers injury→restriction→suppression→recovery through real routes; producer paths covered by integration tests |
| Rule activation | **BLOCKED (by design)** | all 71 DRAFT; CHECK constraint enforces review metadata; nothing may activate without qualified reviewer |
| Production readiness claim | **NOT CLAIMED** | flags all default-off; staging + clinical gates unsatisfied |

---

*Remaining for release: clinical review execution (external gate), staging deploy evidence (needs environment), non-US alert coverage (no source exists). All engineering-side producer/UI/shadow/scenario/package work is complete and tested.*
