# Medical Rule Evidence — Status and Approval Path

**Purpose:** the safety-critical difference between *implemented* and *enabled*
clinical rules. Constraint mechanisms exist; enforcement of each rule is
gated on `reviewStatus = APPROVED`. DRAFT rules are inert by design.

## Current database state (read-only, 2026-11-21)

| Rule type | Model | Total | APPROVED | DRAFT | Effect today |
|---|---|---|---|---|---|
| Condition→ingredient-attribute blocks | `ConditionRule` | 34 | **0** | 34 | none enforced |
| Condition→nutrient limits | `HealthConditionNutrientRule` | 14 | **0** | 14 | none enforced |
| Supplement-interaction research | `supplementInteractionRule` (nutrition-intel effort) | 47 | 0 | 47 | none enforced |

**Net: zero clinical rules are live.** Users whose only protection is a
condition rule currently rely on allergies + dietary patterns + NEVER_RECOMMEND.
This is an intentional fail-closed posture, not a bug — but it must be
visible in release notes.

## Mechanisms (verified in tests with synthetic APPROVED fixtures)

- `ConditionRule` → `constraints.js` `medicalAttributes` → `validate.js`
  `medical` stage → `MEDICAL_ATTRIBUTE_BLOCKED` (hard fail).
- `HealthConditionNutrientRule` → `medicalNutrientLimits` → `limits` stage →
  `MEDICAL_LIMIT_EXCEEDED` (hard fail) / `MEDICAL_LIMIT_UNKNOWN` (review when
  nutrient cannot be computed). `MONITOR`/`PRIORITIZE` → soft (no auto-fail).

## Approval protocol (required before APPROVED)

1. Each rule needs a populated `evidence` record — source citation, strength,
   clinical rationale. **Rules must not be promoted on "generally accepted"
   grounds alone.**
2. Clinical reviewer (dietitian/physician) signs off in `reviewedBy`/`reviewedAt`.
3. Add a regression test per newly approved rule against its condition and at
   least one affected recipe fixture.
4. Re-run `scripts/recipe-data-quality.js` + affected test suites.

## Known evidence gaps (do not fill without a clinician)

- No sodium-limit rules approved for hypertension despite the mechanism
  supporting `LIMIT` — most direct clinical need.
- No potassium/phosphorus CKD staging rules approved.
- `AVOID_IF_INDICATED` semantics need per-condition indication criteria, not
  just thresholds.
- Allergen cross-contact ("may contain") has no `Contraindication` model —
  recipes treat declared `allergens` as definitive.

## A user-visible honesty requirement

Recipe responses must not claim medical safety. A `validated` recipe means
"passed deterministic checks" — the UI copy for medical users should reflect
"reviewed for listed restrictions", not "safe for your condition".
