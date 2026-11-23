# 08 — Multi-Condition Conflict Analysis

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. Conflict machinery that exists today

| Mechanism | Location | Behavior |
|---|---|---|
| Same-target PRIORITIZE vs LIMIT/AVOID conflict | `conditionEvaluation.evaluate` lines 61–66 | Emits `CONFLICTING_ACTIONS` → PERSONALIZATION_REQUIRED — detected, not resolved |
| `conditionsWithoutApprovedFindings` | same file, line 67–68 | Reports which conditions produced no approved findings — honest coverage gap reporting |
| `conflicting_conditions` scenario | docs/nutrition-intelligence gap analysis | Spec'd review trigger; no resolver |
| Deterministic precedence inside activity engine | `mergeDimensions` | medical > functional > environmental by rank; personalization never raises severity — a real conflict-resolution implementation, but activity-domain only |
| Constraint union | `recipes/constraints.js` | block-lists union across conditions → **intersection of restrictions** (always safe direction) |

## 2. Scenario matrix — what happens today vs required

| Combination | Today (executable) | Required behavior | Gap |
|---|---|---|---|
| Diabetes + CKD | Nothing (no user conditions, no approved rules, no nutrient data) | Carb quality + K⁺/PO₄/Na limits; protein target stage-aware; insulin→hypoglycemia fueling rule | Everything |
| MASLD + high TG | Conditions absent | Weight loss 5–10%, alcohol=0, fructose/refined-carb reduction; Mediterranean pattern | Conditions + rules absent |
| HTN + CKD | Nothing | Na <2g/d (KDIGO), K⁺ per stage, protein 0.8g/kg | No sodium/potassium data |
| PCOS + insulin resistance | PCOS row exists, no rules | Low-GI emphasis without fruit-ban; resistance training | IR condition absent |
| Celiac + diabetes | GF text-filter works; T2D inert | GF + carb-quality simultaneously | Half-covered |
| Gout + kidney stones | Gout row exists (rules 0 coverage); stones absent | Purine + oxalate + hydration + uric-acid mediation | Both unenforceable |
| Obesity + heart failure | HF row exists, no rules | Calorie target → clinician-managed (`calorieSafety` codes `heart_failure` supervised — correct!) | Calorie policy unwired |
| Osteoporosis + CKD | Neither fully present | Ca/vit-D adequacy vs PO₄/protein limits | No nutrient data |
| Pregnancy + GDM | Pregnancy row only (not user-settable) | Trimester energy, no automated deficit (calorieSafety review('pregnancy')), glycemic targets | Unwired |
| Diabetes + insulin/SU | No medication model | Pre-exercise carb logic; hypoglycemia symptom escalation (exists in activity engine via symptoms) | Medication model missing |

## 3. Precedence design assessment (Phase 5.2 request)

Proposed hierarchy (safety > contraindication > medication > life-stage > clinician > condition-guidance > adequacy > goals > preferences) is **architecturally consistent** with existing patterns:
- Activity engine already implements rank-merge of dimensions.
- `constraints.js` already unions all hard constraints — the safe direction.
- `conditionEvaluation` already distinguishes INSUFFICIENT_DATA / PERSONALIZATION_REQUIRED / GUIDANCE.

**Missing:** a single cross-domain arbiter. Today, diet-side conflicts resolve by intersection (safe) but there is no explainable "one coherent plan" composer — each surface (suggest/recipes/weekly/activity) applies constraints independently with its own rule set. A user with 5 conditions gets 5 independent filters, not 1 plan.

## 4. Explainability state

Per-recommendation answers available today: which allergens/rules matched (violations), safetyScore, warning strings, `provenance` in constraints, `ruleIds`/`reasons` in activity evaluations. **Missing:** which conditions influenced (conditionName is partially captured), which alternatives were considered (only `allowedAlternatives` stub), when to reconsider (no staleness), what info is missing (exists via `unknown`/`requiredData` — partial credit).

## 5. Verdict

Multi-condition handling = SAFE-BY-OMISSION today (intersection of nothing = everything passes once rules are approved, or nothing fires while DRAFT). No path currently *generates* conflicting advice because no path generates condition advice at all. The architecture to build on is the strongest part of the system.
