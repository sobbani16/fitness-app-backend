# Food Logging — Database Quality Report

Generated 2026-11-22 against the local configured Postgres DB (`DATABASE_URL` from backend `.env`). Counts are real queries; SQL shown. No data was invented or mutated except the serving imports/deletions already documented.

## Schema inventory

Food-related tables present: `Ingredient`, `IngredientCatalog`, `IngredientServing`, `FoodLog`, `UserIngredient`, `FoodPreference`, `FoodInventory`, `FoodTolerance`, `BarcodeProduct`, `ProductCorrection`, `Recipe`, `RecipeIngredient`, `RecipeEngagement`, `SupplementProduct`, `SupplementProductIngredient`.

## Headline counts

| Metric | Count | Query |
|---|---|---|
| Ingredients | 420 | `ingredient.count()` |
| Catalog rows (all usable) | 228 | `ingredientCatalog.count({where:{usable:true}})` |
| IngredientServing rows | 58 | `ingredientServing.count()` |
| Ingredients WITH servings | 18 | `groupBy ingredientId` |
| **Usable catalog items with NO servings** | **210 (92%)** | NOT EXISTS subquery |
| FoodLog rows | 277 | `foodLog.count()` |
| Users with logs | 191 | `COUNT(DISTINCT userId)` |
| UserIngredient rows | 1764 | — |
| Recipes | 258 | `recipe.count()` |
| Recipes missing yield (`finishedYieldG` null/0) | 28 | — |
| Barcode products | **0** | `barcodeProduct.count()` |

## Nutrition completeness

| Check | Count | Notes |
|---|---|---|
| Missing calories | 0 | column NOT NULL |
| Missing fiber (`fiberPer100g` null) | 21 | stays unknown — correctly NOT zeroed (except voice path, VOICE-002) |
| Negative nutrients | 0 | `WHERE any < 0` |
| Implausible macros (>100 g/100 g or >950 kcal) | 0 | — |
| `caloriesPer100g` = null | n/a | non-nullable column |

## Serving coverage

| Category | Count | % of usable catalog |
|---|---|---|
| With verified household serving | 18 | 7.9% |
| Weight/volume only (no rows) | 210 | 92.1% |
| Invalid conversions | 0 (after removing 3 weight-unit pseudo-rows: `srv_bread_wholewheat_2` `srv_bread_white_1` `srv_chicken_breast_raw_1`) | — |
| Remaining weight-unit labeled row | `1 oz (23 whole kernels)` almond — carries kernel count; kept | — |

All 58 serving rows carry `sourceRecord` with USDA `source/fdcId/dataType/description/gramWeight/importedAt/importScript` — full provenance.

## Verification level distribution

`ingredientCatalog.groupBy verificationLevel`: **228/228 GENERIC_COMPOSITION** — zero SOURCE_BACKED_FULL / PARTIALLY_SOURCE_BACKED catalog rows. The serving `sourceRecord`s are USDA-verified, but the catalog verificationLevel column does not reflect that. **Impact:** clients can't distinguish verified vs draft foods from the flag alone; `nutritionStatus`/`verification` strings in DTO are the working signal.

## Duplicates (non-test sources)

14 normalized-name groups, all ×2–5: `glucose tablets x5`, `glucose tablets orange x3`, `glucose tablets grape x3`, `chicken curry x3`, `pad thai {rice noodles,seasoning,sauce,plain} x2`, `almonds raw x2`, `avocado x2`, `spinach raw x2`, `broccoli raw x2`, `quinoa cooked x2`, `chicken teriyaki x2`. The `bread x9` group is `test-fixture` source only (10 fixture rows total — excluded from search via `source != 'test-fixture'`).

## FoodLog integrity

- Orphaned logs (ingredientId → missing row): **0** — FK integrity holds.
- **`nutritionSnapshot` NULL: 260/277 (94%)** — historical logs from before snapshot persistence + the voice path which writes a partial snapshot. These are the "historical records" of Phase 10 — they keep quantityG/nutrients but have no serving/provenance metadata. Backward compat: treat null snapshot = legacy weight entry.
- Serving-bearing logs: rows written since the serving work carry `servingId/servingGrams/selectedServing/servingCount`.

## Data-quality queue (needs human/source work)

| ID | Item | Count | Needed |
|---|---|---|---|
| DATA-001 | Catalog items without any serving | 210 | USDA portion import per food (script exists — extend PRIORITY map or auto-match by name) |
| DATA-002 | `rice_cooked` catalog row missing | — | create catalog + ingredient rows |
| DATA-003 | Duplicate normalized names | 14 groups | merge/review — may be intentionally different foods (glucose tablet variants) |
| DATA-004 | `verificationLevel` all GENERIC_COMPOSITION | 228 | promote USDA-backed items to SOURCE_BACKED after sourceRecord review |
| DATA-005 | BarcodeProduct empty | 0 | branded-food import or barcode service wiring |
| DATA-006 | Recipes missing yield | 28 | recipe data owner |
| DATA-007 | Legacy logs without snapshot | 260 | none required — treat as weight entries; no backfill (values are user-confirmed history) |

## SQL used

```sql
-- usable catalog items lacking any serving row
SELECT COUNT(*) FROM "Ingredient" i JOIN "IngredientCatalog" c ON c.id=i."catalogId"
 WHERE c.usable AND NOT EXISTS (SELECT 1 FROM "IngredientServing" s WHERE s."ingredientId"=i.id);
-- orphan check
SELECT COUNT(*) FROM "FoodLog" fl LEFT JOIN "Ingredient" i ON fl."ingredientId"=i.id
 WHERE fl."ingredientId" IS NOT NULL AND i.id IS NULL;
-- snapshot coverage
SELECT COUNT(*) FROM "FoodLog" WHERE "nutritionSnapshot" IS NULL;
```
