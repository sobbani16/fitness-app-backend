# Health-Aware Activity Safety — Validation Report (INTERIM)

**Status: WORK IN PROGRESS — NOT PRODUCTION APPROVED.**
Branch `feat/activity-safety-engine` · Last checkpoint: `d417e5f` (backend), `7d4c3d1` (mobile).

This report reflects the current implementation state. Sections marked ⏳ are incomplete; nothing in this document constitutes clinical sign-off or release readiness. The 150-scenario target and full clinical review remain outstanding.

---

## 1. Executive summary

A deterministic, versioned activity safety engine now exists and is wired into the live recommendation surfaces that were previously disconnected. Weather genuinely influences outdoor dispositions through normalized environmental bands (heat-index, AQI, thunder, wind-chill, alerts) with unknown/stale data never treated as safe. Health restrictions — active injuries, documented prohibitions, surgeries without clearance, mobility profiles, pregnancy, urgent symptoms — are evaluated per candidate activity via a shared service (`src/services/activitySafety/`). Voice reports of injuries/symptoms update the shared context and invalidation is automatic. All 71 clinical rules are seeded `DRAFT` and cannot fire for real users until a qualified reviewer approves them — automated tests verify code consistency only, never medical correctness.

## 2. Architecture before → after

**Before:** mobile weather buckets (temp/precip only) + dead backend `applyWeather` + unused `/recommendations` + misleading summary claim. Health data had no effect on activity suggestions.

**After:** one engine evaluates every candidate across four dimensions (medical / functional / environmental / personalization) → decision via DECISION_RANK merge (ALLOW < MODIFY < DEFER_OUTDOOR < INSUFFICIENT_DATA < NEEDS_CLINICAL_REVIEW < BLOCK < URGENT). Producers: `/activity-safety/recommendation` (canonical), `/activity-safety/evaluate`, `/activity-safety/symptoms|injuries|feedback|profile`, voice REPORT_INJURY/REPORT_SYMPTOM + START_WORKOUT pre-check, todayActions `safety_check` gate, reminder workout/movement suppression, mobile dashboard suggestion path. `/weather/environment` serves normalized observations.

## 3. Files changed

Backend (branch `feat/activity-safety-engine`):
- NEW `src/services/activitySafety/`: `constants.js`, `activityCatalog.js`, `environment.js`, `engine.js`, `context.js`, `index.js`, `rulesData.js`
- NEW `src/services/environmentService.js` — Open-Meteo v2 + US-AQI normalization
- NEW `src/routes/activitySafety.js` — 7 endpoints
- MOD `src/routes/weather.js` (+`/environment`), `src/routes/index.js` (mount), `src/routes/voice.js` (intents + pre-check + latent `flags` fix)
- MOD `src/services/voice/voiceParser.js` (safety intents), `src/services/todayActions.js` (gate), `src/services/reminders/scheduler.js` (suppression), `src/services/summaryService.js` + `recommendationEngine.js` (honesty)
- MOD `src/config/featureRegistry.js` (+4 flags)
- NEW `scripts/seed-activity-safety-rules.js`, 4 test files, `docs/clinical/*`, `docs/implementation/*`

Mobile (main, `7d4c3d1`): `src/api/activitySafety.ts`, `src/hooks/useSafetyRecommendation.ts`, `src/services/safetySuggestion.ts`, `DashboardScreen.tsx`, `useWeather.ts`, `featureKeys.ts` (+4 keys), test.

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

`DashboardScreen` weather suggestion prefers engine line when flag on; local buckets remain offline fallback. Feedback/report UI screens: ⏳ not built (API client ready).

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

100 automated tests total (94 backend + 6 mobile composer). Target: 150+ — ⏳ fixture expansion planned (`data/activitySafetyScenarios.json` runner).

## 13. Test results

| Suite | Result |
|---|---|
| engine | 57/57 ✅ |
| routes (mocked prisma) | 17/17 ✅ |
| voice parser+execute | 17/17 ✅ |
| todayActions gate | 3/3 ✅ |
| regressions (voice/weather/flags/summary/recs/reminders/dailyProgress/apiReliability) | 166/166 ✅ |
| mobile (weather/flags/composer) | 30/30 ✅, tsc+eslint clean |

## 14. Remaining unsupported cases

- Group-class/exercise-library-level evaluation (catalog-level only)
- Real NWS alert provider; UV is forecast-hour approximation
- `rehabInstructions` semantic evaluation; trainer-facing review UI
- Wearable recovery metrics → engine inputs (not yet consumed)
- `isEvaluationFresh` cache layer has no consumer cache yet
- LLM rewording path not built (deterministic templates only)

## 15. Clinical review requirements

Release gate unchanged: qualified clinician/specialist must review (a) all 71 DRAFT rules' evidence, (b) high-risk scenario outcomes, (c) escalation copy, before any `APPROVED` status. The CHECK constraint makes unreviewed approval impossible by accident (requires reviewedBy/reviewedAt).

## 16. Release blockers

1. Clinical review of rules + scenarios (hard gate)
2. Real alert provider or documented no-coverage handling
3. Trainer/coaching/wearable entry points not yet wired
4. Mobile feedback/report screens not built
5. 150-scenario target not met (currently 100)
6. Shadow-mode diff job not written
7. No staging/production deploy yet

## 17. Deployment status

Local only. Migration applied additively to dev DB; production apply pending deploy pipeline. All flags default off — zero production behavior change until enabled.

## 18. Rollback procedure

1. Set `FF_ACTIVITY_SAFETY_ENGINE=false`, `FF_HEALTH_AWARE_RECOMMENDATIONS=false`, `FF_WEATHER_INTELLIGENCE_V2=false`, `FF_ACTIVITY_SAFETY_SHADOW_MODE=false` (env overrides beat provider) → routes 403, mobile falls back to local buckets, todayActions/reminders/voice gates inert.
2. DB migration is additive-only — no rollback required; tables remain dormant.
3. **Never** roll back to a path that bypasses recorded restrictions: if `/recommendations?weather=` legacy path is restored, suppress its activity output (it does not evaluate restrictions) rather than reactivating it.
4. Rule de-activation: set `reviewStatus` back to `DRAFT` — engine instantly stops firing it (APPROVED-only load).
5. Persisted evaluations/`shadow` rows are audit artifacts — keep for post-rollback comparison.

---

*Next session: mobile feedback UI + scenario fixture expansion + trainer/wearable wiring + shadow diff job.*
