# USDA Import — Executable Manifest (awaiting authorization)

**Status: NOT EXECUTED. No DB writes performed.** Manifest: `data/usda-preview-manifest.json`.

## Final eligible batch (source-verified)

| Step | Result |
|---|---|
| Test-catalog fdc-linked candidates | 40 |
| USDA records fetched (exact IDs, no fuzzy) | 40/40 |
| Identity check (name↔description token match ≥50%) | 40 match / 0 review |
| Prep state | all UNSPECIFIED → `preparationType: OTHER` (no raw/cooked asserted) |
| Unit mismatches (after µg≡mcg normalization) | 0 |
| **Proposed inserts** | **40 profiles + 716 `IngredientNutrient` rows** |
| `SUGAR_ADDED` rows | 0 — USDA has no added-sugar values here; nothing inferred |
| Missing core nutrients | 9 profiles missing FIBER only (all glucose products — null preserved as absence) |
| Marker collision | none — `sourceDataset='usda_fdc_usda-preview-1'` unused; test has 0 profiles |

## Nutrient reference seed required

**26 rows** in `fitness_test.Nutrient` (of dev's 27 codes; `SUGAR_ADDED` unused). Reference data only — no user data copied.

## Transaction plan (on authorization)

1. Verify `DATABASE_URL`→`fitness_test`. 2. Baseline counts (profiles=0, nutrients=0, ingredientNutrients=0). 3. Insert 26 `Nutrient` rows. 4. Per candidate: `upsert` profile on deterministic `identityKey` + nested `IngredientNutrient` creates — idempotent, single `$transaction`. 5. Re-run = 0 new rows. 6. Rollback: `deleteMany{sourceDataset:'usda_fdc_usda-preview-1'}` (cascade removes join rows; verified PASS on synthetic fixture).

## Authorization request (verbatim)

> "Authorize inserting 40 `IngredientNutritionProfile` + 716 `IngredientNutrient` + 26 `Nutrient` rows into **fitness_test only** per `data/usda-preview-manifest.json` (batch `usda-preview-1`, `verifiedAt NULL`). No updates, no fuzzy matches. Rollback verified."

## EXECUTION RESULT — 2026-11-22 (authorized, fitness_test only)

| Check | Result |
|---|---|
| Target verified | `fitness_test` (URL check pre-execute) |
| DB drift detected | Reseed rotated IDs — fdcId set + names identical → manifest remapped by exact fdcId, re-verified pre-insert |
| Inserted | **26 Nutrient + 40 profiles + 716 joins = 782 rows** (exact ceiling), atomic `$transaction`, `upsert` on `identityKey`/code/`(profile,nutrient)` |
| IDs retained | `data/usda-preview-1-inserted-ids.json` (40 profile UUIDs) |
| Integrity | 0 orphan joins, 0 missing parents, 0 negative amounts, 0 unit mismatches (kcal/g/mg/mcg only), all 40 IDs persist, `verifiedAt` NULL on all 40 |
| Coverage | test profiles 0→40 source-backed USDA (100% of fdc-linked test catalog) |
| **Consumer gating (finding)** | All intelligence paths filter `verifiedAt:{not:null}` → unverified batch is **invisible to classification/portions/substitutions** by design (empirically: 0 visible). Provenance stored; activation requires reviewer `verifiedAt`. This is correct fail-closed behavior, not a defect. |
| Regression | usdaService/foodIntel/ingredientV5/foodExpansion: **35/35 pass**; no assertion weakened |
| Rollback | `deleteMany{sourceDataset:'usda_fdc_usda-preview-1'}` — verified mechanism; **not executed** (requires separate approval) |
