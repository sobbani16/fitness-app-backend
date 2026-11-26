# 07 — Clinical Safety Audit

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. Governance machinery (strong)

| Mechanism | Evidence |
|---|---|
| Rule lifecycle | `reviewStatus` DRAFT→REVIEWED→APPROVED on ConditionRule, HealthConditionNutrientRule, ActivitySafetyRule; DB CHECK constraint forbids APPROVED without `reviewedBy`+`reviewedAt`+`evidenceSourceId`+`clinicalAction` |
| Evidence registry | `RuleEvidence` (org, guidelineTitle, sourceUrl, publicationYear, lastReviewedAt, evidenceNotes) — 12 real entries + 9 fixture rows |
| Applicability criteria | `applicabilityCriteria` JSON validated by `validCriteria` (scope ∈ GENERAL/CONDITION/LAB_DEPENDENT/MEDICATION/CLINICIAN; typed key=equals requirements, no dup keys) |
| Clinician limits | `clinicianLimits` input path in `conditionEvaluation` — per-user clinician-set thresholds override general rules; invalid → PERSONALIZATION_REQUIRED |
| Evaluation semantics | Unknown → INSUFFICIENT_DATA; missing context → PERSONALIZATION_REQUIRED; verified-profile requirement; serving math via Decimal; conflicting actions → PERSONALIZATION_REQUIRED |
| Admin review | `routes/admin.js` — rule review queue listing + review endpoints (`type=condition|nutrient`) |
| Safety audit | `SafetyAuditLog` (142 rows) records every pipeline run; `ActivitySafetyEvaluation` persists decisions w/ policyVersion |
| Conservative default | `missingDataBehavior='conservative'` default; `inputStatus='unsupported_input'` keeps unmeasurable rules inert |

## 2. Gaps

| ID | Sev | Finding |
|---|---|---|
| F-C1 | CRITICAL | **No production write path for UserHealthCondition** — the clinical engine's primary input cannot exist for real users. Condition data model is complete but unreachable (see 02 #7) |
| F-C2 | HIGH | 0 APPROVED rules anywhere (34+14+71 DRAFT) → every governed surface returns INSUFFICIENT_DATA/inert. Clinical value = 0 today; conservative posture prevents harm but delivers nothing |
| F-C3 | HIGH | No medication model → MEDICATION-scope applicabilityCriteria can never resolve → medication-gated rules permanently PERSONALIZATION_REQUIRED (insulin/sulfonylurea, warfarin, levothyroxine, metformin unmodelable) |
| F-C4 | MEDIUM | LAB_DEPENDENT scope unresolvable — no lab ingest (F-N/labs). Rules needing eGFR/A1c/lipids can never fire |
| F-C5 | MEDIUM | `supplements/safetyEngine.js:80` compares `reviewStatus === 'PUBLISHED'` — ClinicalRuleReview enum lacks PUBLISHED → dead branch (fails safe but is a bug) |
| F-C6 | MEDIUM | Allergies stored twice (Allergy/UserAllergy + allergy-rows inside HealthCondition) — dual sources of truth; allergy-in-condition rules use weaker attribute matching than the canonical allergen path |
| F-C7 | LOW | `Heart failure` row is lowercase "heart failure" (name normalization inconsistent; unique key is name-based → future dup risk) |
| F-C8 | INFO | RuleEvidence fixture rows must be excluded from any production evidence reporting |

## 3. Referral & escalation paths

- `URGENT_ESCALATION` (activity engine) — real, tested.
- `NEEDS_CLINICAL_REVIEW` — decision emitted but **no consumer-side clinician queue**: `docs/clinical/clinical-review-queue.md` defines workflow for rule review, not patient review. No route writes a user-facing referral artifact.
- Calorie floor/suspension policy exists (`calorieSafety`) but unwired.
- Eating-disorder suppression: `ed_risk` review trigger exists in calorieSafety proposal only.

## 4. Claims posture (checked against docs/audits/activity-safety-claims-inventory.md + code)

Verified consistent: engine emits "not evaluated further / needs reviewed guidance" language, never "safe to do X"; mealSuggestion disclaims "not a clinical guarantee"; supplement engine emits "no interaction found ≠ safe". No curative or diagnostic claims found in audited paths.
