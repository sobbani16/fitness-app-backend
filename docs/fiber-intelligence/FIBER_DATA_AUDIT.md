# Fiber Data Audit — Smart Fiber Intelligence

Audited: 2026-11-22 against the local development database (`fitness_app`).
Read-only queries — **no production or dev nutrition records were modified**.

## 1. Coverage snapshot

| Table | Total | Fiber present | Fiber missing | Notes |
|---|---|---|---|---|
| `Ingredient` | 430 | 409 (`fiberPer100g` non-null) | 21 | Missing list below |
| `IngredientCatalog` | 228 | 220 linked ingredients have fiber | 8 | Catalog-backed rows missing `fiberPer100g` |
| `IngredientServing` | 422 | — | — | Gram conversions exist; teaspoon/tablespoon units audited in §4 |
| `IngredientNutritionProfile` | 18 | 18 `FIBER` nutrient rows | — | Verified-profile coverage is thin (18 ingredients only) |
| `Recipe` | 258 | `fiberG` column populated | — | `Recipe.fiberG @default(0)` — see §3 caution |
| `RecipeIngredient` | 1,714 | 0 (new column, all NULL) | 1,714 | Line-level `fiberG` added by `20261224000000_fiber_intelligence`; deliberately not backfilled — per-line fiber is computed from `Ingredient.fiberPer100g` at read time, keeping provenance honest |
| `Supplement` | 207 | 3 with non-zero `fiberG` | 204 | **`fiberG @default(0)` is a record-keeping zero, not a measured zero** — see §5 |
| `FoodLog` | 290 | 103 | 187 (64%) | Large unknown share — the confirmed/estimated/unknown taxonomy is load-bearing, not cosmetic |

## 2. Ingredients missing `fiberPer100g` (21 rows)

| Category | Rows | Assessment |
|---|---|---|
| Glucose tablets / liquid glucose (USDA) | ~12 | Genuinely ~0 g fiber — likely NULL in source data rather than a measurement. Safe to treat as near-zero **only after** verification; currently reported as `unknown` — correct behavior. |
| Thai/Asian condiments (humai-catalog): Thai red curry paste, Lemongrass, Gochujang, Berbere blend, Pad Thai seasoning | ~7 | These DO contain small fiber amounts. Filling gaps requires a cited source — do not guess. |
| USDA misc (spinach spaghetti, Pad Thai mix dupes) | ~2 | Duplicated names exist ("GLUCOSE TABLETS, GRAPE" ×3) — separate dedupe concern, flagged for the ingredient catalog owners. |

## 3. Serving-unit assumptions

- `IngredientServing` covers 422 rows with gram conversions; recipe lines store `amountG`.
- `Recipe.fiberG @default(0)` predates this work: a `0` there is "recorded zero" (probably computed at recipe save) but is indistinguishable from "never computed". Consumers should prefer recomputing recipe fiber from `RecipeIngredient.amountG × Ingredient.fiberPer100g` when the stored total matters for sequencing/recommendations.
- Raw vs cooked: `IngredientNutritionProfile.preparationType` supports per-preparation values, but only 18 ingredients have profiles — most per-100g values carry a single basis. The photo-scan pipeline already asks the model to distinguish raw/cooked; recipe yields rely on `nutrition.recipe(yieldGrams)`.

## 4. What was NOT found (verified absent)

- No fiber values are hard-coded in services — every consumer reads `fiberPer100g`/`fiberG` fields.
- No teaspoon/tablespoon→gram conversion exists for supplements (this matters for psyllium — see SUPPLEMENT_SAFETY_REVIEW).
- `Supplement.servingSizeG` exists but is **not** a verified label conversion — it is catalog metadata.

## 5. Supplement catalog caveat (load-bearing for Phase 7)

`Supplement.fiberG` defaults to `0` on 204/207 rows. A `0` here means "the catalog import recorded nothing", NOT "this product contains 0 g fiber". Therefore:

- **Never** read `Supplement.fiberG` as a verified contribution.
- Only `SupplementProduct` rows with `verificationStatus ∈ {LABEL_REVIEWED, VERIFIED}` and structured `labelFacts` may feed label-based fiber math.
- Psyllium's seed entry is `UNREVIEWED_RESEARCH_DRAFT` + `product_label_required` — consistent with this posture.

## 6. Gaps → follow-ups

| Gap | Action taken / proposed |
|---|---|
| 21 ingredients missing `fiberPer100g` | Left NULL (honest unknown). Follow-up: USDA FDC backfill script with `sourceMetadata` provenance — separate review, not part of this feature's runtime path. |
| `RecipeIngredient.fiberG` all NULL | Column added; populated going forward by recipe import paths. Read-time fallback computes from ingredient per-100g — no silent 0. |
| `Supplement.fiberG` conflation | Documented; Phase 7 pathway reads verified `SupplementProduct` labels only. |
| 18-profile verified coverage | Verified profiles are additive; unprofiled ingredients fall back to `Ingredient.fiberPer100g` (USDA-sourced). |
| Duplicate ingredient names (glucose tablets ×3) | Reported to catalog owners — out of scope for fiber work. |

## 7. Invariants established by this audit

1. `NULL`/`unknown` fiber is never summed as 0 — `nutrientCompleteness` + `fiberStateOf` carry it.
2. `Supplement.fiberG = 0` is "unrecorded", not "measured zero".
3. `Recipe.fiberG = 0` is ambiguous — prefer recomputation for sequencing.
4. No fixed grams-per-teaspoon assumption may ever exist for psyllium or any supplement.
