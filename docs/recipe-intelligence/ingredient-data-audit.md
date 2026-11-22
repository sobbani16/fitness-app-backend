# Ingredient Data Audit — Identity & Resolution Quality

**Source:** `scripts/recipe-data-quality.js` output (2026-11-21). Raw JSON: `database-quality-raw.json`. See also `database-quality-report.md` for the full severity ranking.

## Catalog identity (228 items)

- 0 items missing `ingredientId` (all link to a usable `Ingredient` with macros)
- 0 items missing a category — but a category of `uncategorized` exists as a
  real value in the enum-free string column; a spot check is warranted on
  whether it's used.
- 0 duplicate aliases/normalized names within the catalog
- 44 items carry name-level allergen hints without declared allergens
  (see database-quality-report §1 for true-positive vs millet false-positives)

## Recipe→catalog linking (258 recipes, 55 unlinked lines)

55 `RecipeIngredient` rows have `ingredientId: null` — the line's `name`
(`salmon`, `chicken breast`, `rice`, `asparagus`, `vegetables`, `brown rice`,
`cottage cheese`) does not resolve to a catalog item. Concentrated in the
230-recipe RESEARCH_DRAFT import; catalog is Indian-staple-heavy and lacks
common Western staples.

**Consequence:** `validate.js` identity stage flags these
`INGREDIENT_IDENTITY_UNRESOLVED` → NEEDS_REVIEW (or NEEDS_CLARIFICATION when
the name implies an allergen). Fail-closed, but the gap caps catalog coverage
of generation/matching.

## Name-resolution risk register

| Risk | Example | Mitigation in place |
|---|---|---|
| Substring false-positive | `eggplant`→`egg`, `walnut`→`nut` | word-boundary+plural matching (`textHasTerm`) — tested |
| Deceptive name, no decl. | `Kodi vepudu` (chicken), no temp/allergen decl. | text matching can't catch → declared-allergen + unlinked gaps flagged |
| Compound/synonym gap | `paneer`↔`cottage cheese`, `dahi`↔`yogurt` | catalog `aliases` field exists; coverage thin for Indian↔Western synonyms |
| Plural-vs-alias allergy rows | `Peanuts`/`peanut` in `Allergy` | merge + add alias entries (report §6) |

## Nutrition identity (420 ingredients)

- 0 missing `caloriesPer100g`.
- 5 implausible-macro flags — **4 are false-positives** (whey/dried-egg-white
  protein 77–84g/100g is legitimate); **1 genuine defect**: `GLUCOSE` macro
  sum >100g/100g.
- `computeFromLines` never imputes 0 for missing values — unresolved lines
  land in `_unresolvedLines` and degrade nutrition to `INSUFFICIENT`.

## Recommended data work (owner decisions)

1. Extend catalog with common staples; run relink pass on the 55 null lines.
2. Tag `sourceRecord.allergens` on confirmed wheat/gluten items.
3. Add Indian↔Western synonym aliases (paneer, dahi, atta, maida, besan).
4. Merge `peanut`/`Peanuts` Allergy rows; add canonical `Peanut` alias.
5. Correct `GLUCOSE` macros; raise implausible-protein bound to ~95g.
