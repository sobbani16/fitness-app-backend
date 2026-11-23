# 15 — Critical Findings Register

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
Every finding has reproduction evidence in `18-DATABASE-QUERY-EVIDENCE.md` or named source files.

## CRITICAL

| ID | Finding | Evidence | Remediation |
|---|---|---|---|
| **F-C1** | **No production write path for `UserHealthCondition`** — real users cannot record conditions; the entire condition-aware safety/recommendation system (16 services read it) only works via `routes/safetyFixtures.js` (env-gated test fixture). Feature = unreachable. | grep: only `safetyFixtures.js:58` creates rows; DB count=1; no mobile screen | Build `/me/health-conditions` API + mobile UI + consent (doc 13 §2) — **P0.1** |
| **F-C2** | **Zero APPROVED clinical rules** — 34 ConditionRule + 14 HealthConditionNutrientRule + 71 ActivitySafetyRule all DRAFT → governed surfaces return inert results end-to-end. System is correctly conservative but delivers no clinical value. | psql group-bys (Q3); all consumers filter `reviewStatus='APPROVED'` | Clinical review queue activation; seed rules from `17-EVIDENCE-SOURCE-REGISTER` — **P0/P1** |
| **F-C3** | **No medication model** — MEDICATION-scope rule criteria can never resolve; insulin/SU hypoglycemia, warfarin–vit-K, levothyroxine–Ca/Fe timing, metformin–B12 are unmodelable. Highest-severity safety gap for T2D/HTN/CKD users. | schema.prisma has no Medication model; `medicationActivityFlags` is coarse JSON only | P0.2 model + minimal interaction registry |
| **F-C4** | **No lab/clinical measurement ingest** — cannot track A1c/lipids/BP/waist/eGFR → health-outcomes claims unmeasurable; LAB_DEPENDENT rules unresolvable | `HealthMeasurement.metric` enum is wearable-only; no BP/lab table | P0.3 `ClinicalMeasurement` + `/me/clinical-measurements` |

## HIGH

| ID | Finding | Evidence | Remediation |
|---|---|---|---|
| F-N1 | Micronutrient coverage **4.2%** — 18/426 ingredients have nutrient profiles; sodium/potassium/phosphorus/sat-fat/sugar unknown for ~96% → HTN/CKD/T2D rules cannot evaluate food | Q6 | USDA FDC backfill — P0.4 |
| F-N3 | SYSTEM recipes (28, most-visible `isSystem=true`) have stale nutrition: **15/28 off >20%** vs own ingredient math; 17 unresolved lines | Q7 | recompute+reseed — P0.5 |
| F-N4 | Ingredient attribute errors: salmon=`HIGH_MERCURY` (wrong — FDA "Best Choice"), oats=`CONTAINS_GLUTEN` (context-dependent), banana/sweet-potato=`HIGH_GLYCEMIC` blanket; rule-referenced attrs (HIGH_SODIUM/K⁺/PO₄/PURINE/HFCS/IODINE) have **zero** ingredient coverage | Q13 | sourced attribute remediation + portion-aware model |
| F-R1 | `mealRecommendationService.generateFoodSuggestions` drops `conditions` param — condition filtering silently absent on `/safety/recommend` | mealRecommendationService.js:172 signature | include conditions or deprecate path |
| F-E1 | Cardio = **14/884 exercises (1.6%)** — aerobic prescription impossible | Q11 | expand catalog — P1.6 |
| F-E2 | Activity medical-dimension rules all DRAFT → only always-on mechanics (injuries/symptoms) protect users | Q3 | rule review — P0 |
| F-S2 | New PHI tables must register in `accountData` ownership lists or account deletion orphans health data | accountData.js OWNED/INCLUDES pattern | deletion-coverage test — P0 |

## MEDIUM

| ID | Finding | Evidence |
|---|---|---|
| F-N5 | Test fixtures in `Ingredient` (10: 9×"BREAD") + `RuleEvidence` (9) — pollute catalog & evidence registry | Q8/Q5 |
| F-N6 | Serving coverage 44.6% (190/426 ingredients); all servings marked non-estimated | Q10 |
| F-N8 | HealthCondition table mixes allergies+Pregnancy with diseases — dual truth w/ Allergy system | Q2 |
| F-C5 | `supplements/safetyEngine.js:80` `reviewStatus==='PUBLISHED'` — impossible enum value; dead branch (fails safe) | safetyEngine.js:80 |
| F-C6 | GERD rules blanket-warn ACIDIC/SPICY/HIGH_FAT — ACG 2022 wants individualized triggers | Q4 vs ACG evidence |
| F-E3 | Exercise model lacks contraindication/intensity metadata needed for osteoporosis/CVD restrictions | schema Exercise |
| F-C7 | `heart failure` name non-canonical case; name-unique key → dup risk | Q2 |
| F-S3 | Voice route auto-writes injury/symptom records — consent UX review needed before conditions join | voice.js:400,428 |
| F-R3 | Recipe model lacks sodium/sugar/sat-fat/potassium/phosphorus columns — nutrient rules have nothing to evaluate at recipe level | schema Recipe |
| F-E4 | No consumer-side clinician-review queue — `NEEDS_CLINICAL_REVIEW` decisions have no resolution artifact | docs/clinical has rule-review only |
| F-E6 | Medication-activity flags are opt-in JSON only; no verification or interaction depth | schema UserActivityProfile |
| F-N7 | Serving coverage: 190/426 (44.6%) ingredients lack serving definitions; all servings marked `estimated=false` | Q10 |

## Positive findings (verified strengths)

- Deterministic-governance posture is consistent everywhere (APPROVED-only, unknown≠safe, INSUFFICIENT_DATA semantics).
- Recipe constraints + AI generation/validation pipeline: server-authoritative, injection-hygienic, honest NO_ELIGIBLE_RECIPE.
- Activity safety engine: URGENT_ESCALATION dominance, clearance precedence, missing-data conservatism — clinically sound design.
- Feature flags: kill-switch + env guards + server enforcement — mature.
- Pose coaching: uncertainty states exhaustive; consent-gated analytics-only storage.
- Tests: backend 154/156 suites / 5,957 tests PASS; mobile 93/93 / 673 PASS; typecheck clean.
- Account deletion/export: comprehensive.
