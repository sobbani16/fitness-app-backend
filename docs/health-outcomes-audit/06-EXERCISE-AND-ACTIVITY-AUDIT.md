# 06 — Exercise & Physical Activity Audit

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. Assets

| Asset | State |
|---|---|
| Exercise library | 884 exercises, 100% muscle-mapped (3,735 ExerciseMuscle rows, all valid roles), 0 orphans |
| Categories | strength 584, stretching 123, plyometrics 61, powerlifting 38, olympic 35, strongman 21, **cardio 14 (1.6%)**, uncategorized 8 |
| Exercise model | name/level/force/mechanic/equipment/appEquipment/category/instructions — **no contraindication/intensity metadata** |
| Suitability engine | `exerciseSuitability.js` — deterministic; 'review' for injury/rehab/medical-restriction; ADAPT_SOFT offers alternatives; equipment feasibility |
| Activity safety engine | `activitySafety/engine.js` — 4 dimensions; URGENT_ESCALATION dominates; clearance precedence; missing-data conservatism; INSUFFICIENT_DATA; personalization cannot override |
| Safety rules | 71 ActivitySafetyRule rows, **all DRAFT** (15 high / 30 caution / 24 info+2 unsupported-input) |
| Write paths | Symptoms, injuries (route + voice), surgeries, restrictions, activity profile — REAL production paths |
| Workout planner (AI) | Catalog-whitelisted IDs; sets 1–6, rest 30–300s clamps; server-derived limitations unioned; no load prescription |
| Pose coaching | On-device; 16-state engine status; consent-gated analytics-only persistence; `minVisibilitySeen`/`confidence` recorded |

## 2. Condition-compatibility status

| Population | Supported today |
|---|---|
| Injuries/surgeries/NWB/ROM restrictions | YES — strongest path; precedence rules tested (clearancePrecedence tests pass) |
| Pregnancy/postpartum (voluntary) | Structural: contact/fall-risk, supine, Valsalva → MODIFY; vigorous early postpartum → MODIFY |
| Mobility/wheelchair/balance/standing | YES — functional dimension |
| Urgent symptoms | YES — URGENT_ESCALATION before any evaluation |
| Cardiovascular (CAD, HF, PAD, post-stroke) | **NO** — no condition input, no cardiac-stratification rules, no HR-zone gating; `heart_rate_interpretation` flag exists but medication flags are coarse opt-ins only |
| Diabetes hypoglycemia | Partial flag (`hypoglycemia_risk`) — no glucose-data path; no pre-exercise carb logic |
| Osteoporosis/OA/back pain | Indirectly via injury/restriction records — no condition-keyed rules (e.g., no spinal-flexion restriction for osteoporosis) |
| Asthma | envHazards pathway exists (AQI/cold air) — condition key exists in schema but no user-condition source feeds it |
| CKD/liver disease | NO |
| Obesity/deconditioning | `fitnessExperience` + `desiredIntensity` only |

## 3. Findings

| ID | Sev | Finding |
|---|---|---|
| F-E1 | HIGH | **Cardio coverage 14/884 exercises** — a health-outcomes platform cannot prescribe aerobic training from this library; walking/cycling/swimming/elliptical variants essentially absent |
| F-E2 | HIGH | 71 activity rules all DRAFT → medical dimension of engine is inert; only always-on mechanics (injuries/restrictions/symptoms) protect users today |
| F-E3 | MEDIUM | No exercise-condition metadata (intensity ceiling, impact class vs osteoporosis, Valsalva class vs uncontrolled HTN) — Exercise model lacks the fields the 40-condition plan needs |
| F-E4 | MEDIUM | No medical-clearance workflow for CVD/HF/stroke populations — `NEEDS_CLINICAL_REVIEW` exists as a decision but there is no clinician queue for consumer (trainer-side review exists) |
| F-E5 | LOW | Pose coaching satisfies uncertainty requirements (no landmark → `incomplete_body`; model fail → `model_init_failed`; claims only when `tracking:true`) |
| F-E6 | MEDIUM | Medication-activity flags are opt-in JSON only — no medication model behind them |

## 4. Existing strengths to preserve

- Clearance precedence: activity-specific > general; restricted > cleared at equal scope; expired clinician restrictions escalate rather than auto-clear — matches clinical reality.
- Engine never claims "safe": outputs ALLOW/MODIFY/BLOCK/REVIEW/URGENT/INSUFFICIENT_DATA.
- Evaluations persisted with `policyVersion` + `ruleIds` — audit-ready provenance.
