# 13 — Implementation Architecture (Proposal — NOT implemented)

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
Design principle: **reuse existing models/services; add only what is provably missing.** No new microservices. Postgres+Prisma schema extension only.

## 1. Gap → model mapping (reuse-first)

| Required concept (Phase 5.1) | Reuse or new? | Decision |
|---|---|---|
| ConditionDefinition | **Reuse `HealthCondition`** + add `slug`, `category`, `evidenceClass`, `icdHint`, `stagingAxis` JSON; stop storing allergies there (migrate 5 rows to Allergy table) | Extend |
| ConditionEvidence / InterventionContraindication | **Reuse `RuleEvidence` + `HealthConditionNutrientRule` + `ConditionRule`** | Extend |
| UserCondition | **Reuse `UserHealthCondition`** + add `diagnosedBy`, `diagnosedAt`, `stage`/`severityCode`, `consentedAt`, `lastConfirmedAt`, `source` | Extend |
| UserMedication | **NEW `Medication` + `UserMedication`** (name, class, doseText, timing, source, active) — required by MEDICATION-scope rules + hypoglycemia safety | New (minimal) |
| UserClinicalMeasurement | **NEW `ClinicalMeasurement`** modeled on `HealthMeasurement`: metric (hba1c\|ldl\|hdl\|triglycerides\|bp_systolic\|bp_diastolic\|waist_cm\|egfr\|alt\|ast\|uric_acid\|tsh\|fasting_glucose\|phq9\|gad7\|isi\|psqi), value, unit, measuredAt, source∈{user_entry,device,lab_report,clinician}, quality, meta{refRange,labName,method} | New |
| ClinicalSafetyRule | **Reuse ActivitySafetyRule + ConditionRule + HealthConditionNutrientRule** (unified by `code`+`reviewStatus` pattern) | Extend |
| UserOutcomeGoal / OutcomeMeasurement | **Reuse `OutcomeGoal` pattern** — new `UserOutcomePlan` (consumer-scoped, not trainer-scoped) OR extend OutcomePlan w/ `ownerType`; recommend separate thin consumer model `HealthOutcomeJourney` | New (thin) |
| RecommendationEvidence / RecommendationAudit | **Extend `Recommendation` + `SafetyAuditLog`/`ActivitySafetyEvaluation`** — persist `ruleIds`, `conditionsApplied`, `alternativesConsidered`, `missingData` | Extend |
| ClinicianReviewStatus | **Reuse `ClinicalRuleReview` workflow + `docs/clinical/` queue** — add `UserClinicalReview` queue for *patient-level* escalations (currently only rule-level review exists) | Extend/New thin |

## 2. The missing write path (F-C1) — design

```
PUT /me/health-conditions
  { conditions: [{conditionSlug, severity?, stage?, source:'self_report'|'clinician_reported',
                  diagnosedAt?, notes?}], confirmAt }
GET  /me/health-conditions → { active, available catalog w/ education snippets }
DELETE /me/health-conditions/:id → deactivate (keep audit)
```

- Server-side validation against a versioned condition registry (mirrors `A.KEYS` allergen pattern).
- Write triggers `revalidateActivePlans` (existing pattern) + recompute of constraint snapshots.
- Every recommendation surface reads `userHealthCondition` live per request — already true everywhere.
- Consent copy: conditions are used to filter/restrict, not to diagnose or treat; can be removed anytime; deactivation stops rules from firing.
- Mobile: new `HealthConditionsScreen` + onboarding step; reuse `Segmented`/`ListRow` design components; flag `healthConditions` (new registry key, group 'server').

## 3. Deterministic recommendation precedence (to encode in one resolver)

New service `services/health/engine.js` — `resolvePlan(userId, context)`:

```
P1 URGENT_ESCALATION      — active urgent symptoms (existing)
P2 CONTRAINDICATION       — allergies, documented injury/surgery restrictions
P3 MEDICATION SAFETY      — hypoglycemia_risk, warfarin-K⁺/vit-K, levothyroxine timing, metformin-B12
P4 LIFE-STAGE             — pregnancy/postpartum, under-18, lactation (existing pattern)
P5 CLINICIAN LIMITS       — clinicianLimits override path (already in conditionEvaluation)
P6 CONDITION RULES        — APPROVED ConditionRule + HealthConditionNutrientRule + ActivitySafetyRule
P7 ADEQUACY               — nutrient completeness, floor/ceiling checks (calorieSafety wired)
P8 GOALS                  — MacroGoal, goalType
P9 PREFERENCES            — cuisines, dislikes, equipment, convenience
```

Each level produces typed `Finding`s (reuse `conditionEvaluation` shapes). Output = `Plan{ decisions[], findings[], explainability{why, conditionsApplied, evidenceRefs, alternatives, missingData, reconsiderAt}, policyVersion }` persisted to a `RecommendationAudit`-style table.

AI (Leo) may render natural-language explanation **from** this structure only — never generate the plan (mirrors workoutPlanner's "AI proposes, catalog validates" pattern).

## 4. Multi-condition resolution

- Conflicts between APPROVED rules → `PERSONALIZATION_REQUIRED` (existing semantics) + surfaced as "needs your clinician's input — we won't guess" UI.
- Restriction union (existing constraints.js semantics) stays the mechanical fallback.
- New `ConditionInteraction` table (thin): pairs needing authored adjudication (e.g., CKD×sarcopenia protein tension) → clinician-authored resolution rule; absent → INSUFFICIENT_DATA, never guess.

## 5. 90-day journey design (Phase 7)

| Phase | Mechanics (reuse) | New |
|---|---|---|
| 0–7 baseline | profile/goal/allergies intake + injuries/symptoms + consent + plan targets | conditions+meds+life-stage intake; optional baseline labs; BP/waist entries; validated questionnaires (PHQ-9/GAD-7/ISI per condition triggers) |
| 8–30 consistency | todayActions, reminders, habit tracking, weekly review | condition-tagged daily actions; adherence keyed to plan version |
| 31–60 adapt | weeklyReviewGenerator + calorieAdjustmentEngine (guarded) | trend review vs measurement provenance; barriers questionnaire; **no auto aggressive cuts** — floor enforcement via wired calorieSafety |
| 61–90 evaluate | weight/steps/log trends | compare baseline↔follow-up measurements w/ provenance labels; milestone definitions per condition; clinician-follow-up suggestions; **NO cure claims** — "verified change" vs "self-reported" distinct |
| Sharing | none today | Opt-in progress cards: behavioral metrics only by default; labs never auto-included; self-reported vs measured labels; no diagnosis strings |

## 6. Data-flow (one request)

```
Mobile → GET /today
  → auth → loadConstraints (exists)
  → health/engine.resolvePlan: context{conditions(+stage), meds, lifeStage, labs(freshness), injuries, symptoms, env, prefs}
  → precedence cascade → findings + decisions
  → surfaces compose from the SAME resolved constraint set (meals, recipes, activity, supplements)
  → persist evaluation (audit) → response w/ explainability block
```

## 7. Migrations (non-destructive, additive)

1. `ALTER TABLE "HealthCondition" ADD slug, category, evidenceClass, stagingAxis` + backfill slugs; migrate allergy rows → `Allergy`.
2. `ALTER TABLE "UserHealthCondition" ADD diagnosedBy/diagnosedAt/stage/consentedAt/lastConfirmedAt/source`.
3. `CREATE TABLE Medication, UserMedication, ClinicalMeasurement, UserClinicalReview, HealthOutcomeJourney, ConditionInteraction`.
4. `ALTER TABLE Recipe ADD sodiumMg/sugarG/satFatG/potassiumMg/phosphorusMg (nullable — never zero-fill unknowns)`.
5. Rule backfill: author+approve rules per phase (clinical workflow exists).

## 8. Security & rollout

- New feature flag `health_outcomes` (class server) + sub-flags per condition group; env allowlist rollout then PostHog cohorts.
- New PHI tables registered in `accountData.OWNED/INCLUDES` (deletion coverage test, F-S2).
- ClinicalMeasurement writes validated like `/health-data/energy` (bounds, provenance, idempotent keys).
- Rollback: flags off → surfaces ignore new inputs; tables are additive, no destructive rollback needed.

## 9. Complexity estimate (rough, founder-review pending)

| Workstream | Size |
|---|---|
| Condition write path + registry + mobile UI | M (2–3 wk eng) |
| Medication + ClinicalMeasurement models + APIs | M |
| `health/engine` resolver + plan composer + audit | L (3–4 wk) |
| Micronutrient population (USDA backfill for ~400 ingredients) | M + data QA |
| Recipe nutrient roll-up + SYSTEM recipe re-seed | S–M |
| Rule authoring + clinical review for P1 conditions | Clinical-time gated (rules exist as DRAFT seeds — expand) |
| 90-day journey + progress report + share cards | L |
| Cardio exercise expansion | S–M (data) |

## 10. Explicitly NOT in this architecture

- No disease diagnosis, no medication dosing, no lab interpretation → stays under non-device CDS line (doc 11).
- No universal "health score" blending clinical+behavioral — keep separate, labeled.
