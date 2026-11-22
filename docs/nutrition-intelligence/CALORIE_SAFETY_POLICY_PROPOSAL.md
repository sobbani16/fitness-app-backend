# CALORIE_SAFETY_POLICY_PROPOSAL — G4 (INACTIVE)

**Status:** `REQUIRES_PROFESSIONAL_REVIEW` — implemented pure module, **not wired into any route**. Unapproved thresholds stay inactive per runbook.
**Module:** `src/services/calorieSafety.js` · fixtures: `tests/calorieSafety.test.js` (12 cases)

## Design principles

- **No universal calorie minimum.** Floors derive from the individual's Mifflin–St Jeor BMR (`calorieEngine.calculateBMR`), never a hardcoded 1200/1500.
- **Missing anthropometrics → `insufficient_data`**, not a default.
- **Clinician-review contexts always preempt automation**: under-18, pregnancy, lactation, eating-disorder risk, medically complex (e.g., CKD), older + low BMI.

## Proposed evaluation (`evaluateCalorieSafety` — pure)

Output: `{ status, floor, reviewFlags[] }`

| Status | Meaning |
|---|---|
| `insufficient_data` | missing age/sex/weight/height — no floor computable |
| `refer_clinician` | any review-flag context (below) — automated targets suspended |
| `review_watch` | eligible adult but: low BMI, aggressive weight-loss target (>20% below TDEE or <0.9×BMR), or very high activity (≥10h/wk) |
| `ok` | floor = max(BMR × 0.9, TDEE × 0.75) for weight loss; BMR for maintenance/gain |

Review flags: `adolescent`, `pregnant`, `lactating`, `eating_disorder_risk`, `medically_complex`, `older_low_bmi`, `low_bmi`, `aggressive_deficit`, `high_activity`.

## Fixture coverage (tests/calorieSafety.test.js)

low-weight, older (70+), adolescent, pregnant, lactating, highly active, medically complex (CKD), eating-disorder flag, aggressive deficit adult, healthy adult weight loss, maintenance, insufficient data — 12 cases asserting status + which flags fire.

## Evidence anchors for review

- Mifflin–St Jeor (already production BMR — cite Am J Clin Nutr 1990).
- NIDDK/CDC safe-rate-of-loss (~0.5–1 kg/wk → ≤750 kcal/d deficit) — needs citation entry in EVIDENCE_REGISTER before activation.
- No pediatric/adolescent floor — always `refer_clinician` (AAP position).

## Activation path (not done)

1. Clinical reviewer approves thresholds → record in `SAFETY_CASE.md` + DECISIONS (G4 → resolved).
2. Wire `evaluateCalorieSafety` result into `dailyProgress.js` `calorieFloor` field (hook already exists, currently `null`).
3. Flag gate: rollout under `health_score_v2` cohort before global.
