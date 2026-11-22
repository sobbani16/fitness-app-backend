# USDA Preview Preflight (read-only) — 2026-11-22

## Database mismatch — RESOLVED (ceiling revised)

| DB | Catalog | fdc-linked | Profiles | Findings |
|---|---|---|---|---|
| `fitness_app` (dev) | 430 | 186 | 11 verified | 175 candidates, all keyed to DEV ingredient IDs |
| `fitness_test` | 41 | 40 | **0** | Seeded independently — **different IDs for same FDC** |

- Dev candidates matching test ingredient IDs: **0/175**
- fdcId collisions (same FDC, different ingredient id): 39 → inserting dev-keyed profiles into test = FK-safe but *wrong identity*; **rejected**
- Correct ceiling = test catalog's own eligible rows: **40** (40 fdc-linked, 0 existing profiles → 0 conflicts, 0 verified rows at risk)

## Eligible batch (exact)

- **Proposed insert: up to 40 `IngredientNutritionProfile` rows** into `fitness_test` only, keyed to test's own `ingredient.id` values
- Schema corrections vs earlier manifest: `source` enum = `USDA` (not `usda_fdc`); no `sourceBatch`/`verificationStatus` columns exist → batch marker = `sourceDataset='usda_fdc_usda-preview-1'` + `sourceRecordKey` prefix; unverified = `verifiedAt NULL`
- Uniqueness: `identityKey @unique` (`usda|<fdcId>|<prep>|<recordKey>`) → import is upsert-idempotent
- Nutrients: `IngredientNutrient` join rows, `@@unique(profile,nutrient)`, cascade-deleted with profile. `Nutrient` reference table in fitness_test is **EMPTY** → nutrients fixture seed required first (or profiles inserted without nutrient rows)
- Missing nutrients → omit join row (null preservation = absence, never 0)
- No fuzzy matching; prep-state mismatches → `review_required` flag list

## Rollback test — PASS (synthetic record)

Upsert twice → 1 row; `deleteMany{sourceDataset:'usda_fdc_usda-preview-1'}` → 1 row; re-rollback → 0; cascade cleaned `IngredientNutrient`; counts/checksums back to baseline. FK onDelete=Restrict prevents orphan parents.

## Exact owner authorization request

"Authorize inserting ≤40 `IngredientNutritionProfile` rows (`source: USDA`, `sourceDataset: 'usda_fdc_usda-preview-1'`, `verifiedAt: NULL`) into **fitness_test only**, keyed to test's own fdc-linked ingredient IDs, plus prerequisite `Nutrient` reference rows if needed. No updates, no fuzzy matches. Rollback: deleteMany on sourceDataset."
