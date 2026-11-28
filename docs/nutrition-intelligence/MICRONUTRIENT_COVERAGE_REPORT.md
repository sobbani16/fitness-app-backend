# MICRONUTRIENT_COVERAGE_REPORT — HUM-225 audited inventory

Generated from the configured local Postgres (`fitness_app`) on 2026-11-28 by `node scripts/nutrient-coverage-report.js --out docs/nutrition-intelligence/NUTRIENT_COVERAGE_AUDIT.json`. The report is read-only and uses explicit denominators: a profile is not an ingredient, an empty profile is not enrichment, and `amountPer100g = null` means unknown — never zero.

## Current inventory

| Metric | Actual |
|---|---:|
| Unique `Ingredient` rows | 427 |
| `IngredientCatalog` rows | 228 |
| Usable catalog rows | 228 |
| Branded catalog formulations | 0 |
| `IngredientNutritionProfile` rows | 143 |
| Verified profiles | 143 |
| Profiles with ≥1 numeric nutrient | 143 |
| Empty profiles | 0 |
| Profiles containing only unknown nutrient values | 0 |
| `IngredientNutrient` observations | 3,861 |
| Numeric nutrient observations | 3,380 |
| Explicit unknown nutrient observations | 481 |
| Nutrient definitions | 27 |
| Recipe component rows | 1,714 |
| Recipe components linked to `Ingredient` | 1,659 |
| Recipe components missing ingredient link | 55 |
| Recipe components linked to a numeric-profile ingredient | 28 |
| Recipe components linked but nutritionally unresolved | 1,631 |
| Recipe components with `nutritionSnapshot` | 38 |
| Ingredient serving rows | 422 |
| Ingredients with serving rows | 190 |
| Food log rows | 323 |
| Food logs linked to `Ingredient` | 19 |
| Food logs with `nutritionSnapshot` | 63 |
| Food logs with `micronutrients` populated | 0 |
| User ingredient links | 1,824 |
| Unique user-linked ingredients | 193 |
| Evidence profiles | 10 (`NEEDS_REVIEW`) |

## Coverage

| Coverage denominator | Covered | % |
|---|---:|---:|
| Ingredients with any nutrition profile | 143 / 427 | 33.5% |
| Ingredients with a numeric nutrient profile | 143 / 427 | 33.5% |
| Unresolved ingredients (no numeric profile) | 284 / 427 | 66.5% |
| Usable catalog entries linked to a numeric-profile ingredient | 7 / 228 | 3.1% |
| Usable catalog entries unresolved for nutrient propagation | 221 / 228 | 96.9% |
| Recipe components linked to a numeric-profile ingredient | 28 / 1,714 | 1.6% |
| Ingredients with serving rows | 190 / 427 | 44.5% |

## Reconciling prior counts

- Earlier `426 ingredients` → current **427**.
- `142 verified nutrition profiles` was accurate at the first snapshot; a concurrent importer added one verified profile, so the refreshed report shows **143 profile rows** — still not 143 catalog foods.
- Earlier `18 versus 42 profiles` are stale counts; all current **143** profiles are verified and numeric.
- Earlier `283 versus 284 unresolved` is stale; current unresolved is **284** because the ingredient table has 427 rows and 143 have numeric profiles.
- `27 nutrient definitions` is accurate.

## Nutrient observation coverage

Complete current dictionary: 27 definitions across 8 macro, 9 mineral, 8 vitamin and 2 other categories. Across the 143 numeric profiles:

- Fully numeric for all 143 profiles: carbohydrate, total fat, protein, calcium, iron, sodium.
- Nearly complete: saturated fat 142, fiber 142, cholesterol 142, energy 142, magnesium 141, phosphorus 141, potassium 141, zinc 141, vitamin B6 141, folate 140, vitamin A 140, vitamin C 140, selenium 140, vitamin B12 139, vitamin E 136, total sugar 136, vitamin K 134, vitamin D 126, trans fat 18.
- Explicitly absent for all 143 profiles: added sugar and iodine (`0` numeric observations, `143` unknown observations each). These are unresolved data, not zero values.

## Indian-food/search priority audit

Catalog/search names are present for all 28 mandated priority terms, but many remain catalog-only or ingredient-only without recipe propagation:

- Complete across catalog + ingredient + recipe component: idli, poha, rice, dal, curd, paneer, chicken curry, common vegetables, lentils, mango, banana, biscuits.
- Catalog + ingredient but no recipe component: chapati, sambar, biryani.
- Catalog + recipe component but missing ingredient identity: buttermilk, egg curry, ice apple.
- Catalog-only, not ingredient/recipe-backed: dosa, pesarattu, upma, rasam, millets, guava, jamun, street-food umbrella terms, beverages, packaged products.

## Product implication

The backend now has a real micronutrient observation layer, but food logging cannot honestly claim broad micronutrient coverage yet: only 3.1% of usable catalog rows resolve to a numeric-profile ingredient, and only 1.6% of recipe components resolve to a numeric-profile ingredient. The next implementation work is to connect reviewed catalog identities to canonical ingredients/profiles, preserve explicit unknown nutrients, and propagate coverage into recipes, logs, daily/weekly totals and dashboards without treating missing values as zero.
