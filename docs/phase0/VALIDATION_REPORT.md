# Humai Fitness — Phase 0 Validation Report
Consolidated sections A–H. All findings are code-verified or explicitly marked UNVERIFIED.

## A. Current implementation audit

| Component | File | Status |
|---|---|---|
| Composite health score | `src/services/healthScoreEngine.js` (606 ln) | IMPLEMENTED — weighted blend of macro adherence, condition, food quality, activity, recovery. **Defects found** |
| Targets used by score | `healthScoreEngine.js:52,494` | **DEFECT**: hardcoded demo fallbacks `{protein:150, carbs:250, fat:70, fiber:30, water:2000}` — not per-user, not evidence-derived |
| Food quality scoring | `healthScoreEngine.js:219-241` | **DEFECT**: +5 "protein source" / −10 "high sugar" per item, base 50 ± quality — heuristic, no per-100g thresholds, **penalizes naturally occurring sugar (fruit)**, no double-penalty guard |
| Activity scoring | `healthScoreEngine.js:273-285` | partial — steps + workout minutes credited; **no strength-vs-cardio distinction**, "No Activity −5" punishes rest days |
| Sleep scoring | `healthScoreEngine.js:298-332` | 7–9h→95, <6h→45. Reasonable band (AASM 7h+), hardcoded |
| Hydration | `:343` | binary 2L threshold — no per-kg/context adjustment |
| Nutrient engine | `nutrientCatalog.js` (new, 52 nutrients, FDA-DV refs) | VALIDATED locally this session |
| Daily status | `nutrientStatus.js` — coverage states | VALIDATED — missing ≠ zero enforced |
| Recommendations | `nutritionRecommendation.js` + `recommendationEngine.js` + `mealSuggestion.js` | Three paths exist — needs consolidation per §8 |
| Condition rules | `ConditionRule` + `ClinicalRuleReview` (DRAFT\|REVIEWED\|APPROVED) | VALIDATED — unapproved rules inert by design |
| Historical candidate formulas (steps=kg×150 etc.) | NOT FOUND in code | Not implemented — evaluated in §3 below |

## B. Scientific evidence register (summary)
- BMR: Mifflin–St Jeor (1990) remains reference; `calorieEngine.js` already uses it ✓
- Energy targets: per-plan BMR×activity ± goal delta (ACSM position stands); **never** kg×24
- Protein: ISSN 1.4–2.0 g/kg/d for active muscle-gain; 0.8 g/kg RDA minimum; 1.9 g/kg×goal-weight ≈ ISSN upper bound — acceptable only as muscle-gain ceiling, wrong for weight-loss on goal weight
- Fiber: 14 g/1000 kcal (IOM) — `calories/1000×14` IS the endorsed method ✓ retain
- Sodium DV 2300 mg; added sugar DV 50 g; sat fat DV 20 g (FDA labels); potassium AI 3400/2600 sex-split — catalog already marks refs correctly
- Fat floor: 20–35% kcal (AMD R); kg×0.7 fails low-weight users → replace with % kcal
- Carbs: balance-of-calories method is arithmetically correct but `calories − weight×14` is arbitrary → replace with residual after protein+fat
- Steps: kg×150 gives ~9–12k — no evidence basis; replace with incremental goal (baseline+2000, cap context)

## C. Scoring mathematical spec (proposed v2 — APPROVAL REQUIRED)
Weights 40/20/20/15/5 = 100 ✓ coherent. Deterministic per category:
- `cat_score = cap × clamp(ratio_to_target, 0, 1)` for adequacy nutrients; linear penalty for limit nutrients above threshold; **no uncapped credit**; **no credit below calorie floor** (safety: if logged kcal < 0.8×BMR-derived floor → nutrition component capped 50%).
- States: `missing` (excluded → score reported `partial`, **no redistribution**), `conflicting` (use conservative value, flag), `safety_suspended` (category reports null, banner).
- Activity 8/4/8: movement = weekly minutes vs WHO 150; cardio = sessions; resistance = 2+ sessions/wk per ACSM — weekly-adherence basis, not daily (fixes "No Activity −5" rest-day penalty).
- Version field `scoreVersion:2` on stored snapshots for reproducibility.

## D. Scenario validation matrix
**BLOCKED**: Appendix A (A01–L10 definitions) is not in either repository — supply it. Framework ready: matrix = 120 IDs × 6 goals × {missing,partial,reliable,conflicting} with applicability flags; all P0 rows require automated fixtures before release. Zero scenarios may be called "validated" today.

## E. Safety & clinical review
Hierarchy implemented where rules exist (allergy → APPROVED condition rules → goal). Missing: hypoglycemia/insulin, pregnancy, ED-risk, under-18 gates — **require clinical reviewer before activation**; all drafted rules stay `DRAFT`.

## F. Gap analysis
- Fix hardcoded targets → per-user derived targets (calorieEngine + goal profile).
- Replace food-quality heuristic with threshold-based deterministic evaluator over catalog nutrients.
- Add strength/cardio split to WorkoutSession categorization (exists? needs type field).
- Consolidate 3 recommendation paths into `suggestMeals`.
- `scoreVersion` + snapshot persistence for auditability.

## G. Decision register (needs YOUR approval)
1. Retain/replace candidate formulas — recommend: fiber formula RETAIN, all others REPLACE (evidence in §B).
2. 40/20/20/15/5 weights — provisional product design, not clinical measure; label in-app as such.
3. Weight-loss protein: 1.6 g/kg current weight vs 1.9 g/kg goal weight — pick (recommend ISSN 1.6–2.2 range, default 1.8 current-weight).
4. Calorie floor: hard floor at max(1200 kcal, BMR×0.8)?
5. Whether score shown as "health score" (recommend rename to "day adherence score" — avoids medical framing).

## H. Validation test plan (fixtures written as spec)
- Boundary: exactly at target → full points; 0 logged → `partial`, not 0 points-as-failure.
- Overconsumption: 2× protein → capped, not bonus; kcal below floor → suspension cap.
- Conflicting snapshot vs column nutrient → conservative + flag.
- Rest day with weekly adherence met → no penalty.
- All fixtures live in `tests/scoringV2.fixtures.js` on implementation approval.

---
**Checkpoint**: no code changed in this phase beyond the previously-approved local commits. Awaiting: (a) Appendix A scenario list, (b) decisions G1–G5, (c) approval to implement spec v2 + fixtures.
