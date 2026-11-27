# HUM-4 — Nutrition intelligence review: findings (dev DB, 2026-11-26)

## Method
Deterministic read-only audit queries against the dev catalog (426 ingredients,
422 servings, 34 safety rules). No production data touched.

## Findings

**F-1 CLEAR DATA ISSUE — fixed in this PR (version-controlled, dry-run script)**
`Fluid replacement, 5% glucose in water` — stored 0 kcal, 0 carbs/100g. By its
own product identity a 5% glucose solution carries 5 g carbohydrate per 100 g
(≈20 kcal/100g). Zero is impossible; the fix is arithmetic from the labeled
composition, not an invented conversion.

**F-2 CONVENTION DECISION NEEDED — owner adjudication, NOT auto-fixed**
13 spice/seed rows (chili powder, cinnamon, flax, chia, cocoa, curry powder…)
have protein+carbs+fat+fiber > 110 g/100g. Root cause candidate: USDA "total
carbohydrate" includes fiber, so storing fiber separately double-counts it.
These rows may be individually correct under a carbs-include-fiber convention
but inconsistent under a carbs-exclude-fiber one. **Decision needed: declare the
catalog's carbohydrate basis convention, then recompute one side consistently.**
Random per-row edits without the convention would be fabrication — refusing.

**F-3 KNOWN/OWNER-TRACKED — cross-reference pc-HUM-29 (dedup)**
10 duplicate normalizedName groups (bread ×9, glucose-tablet variants, chicken
curry ×3). Merge adjudication with FoodLog-reference preservation already filed
as a needs_human on pc-HUM-29 — not duplicated here.

**F-4 REVIEW QUEUE — legitimate unknowns, no action**
21 ingredients with null fiber. Per the unknown-vs-zero contract null is honest;
each needs a source lookup before confirmation, not fabrication.

**F-5 CLEAN — verified negatives**
0 implausible servings (all within 0–2000 g), 0 estimated servings, 0 negative
nutrient values, 0 implausible >900 kcal/100g rows (the 3 zero-kcal rows other
than F-1 are table salt and water — correct zeros).
