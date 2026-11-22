# Database Quality Report — Recipe Intelligence (Phase 15)

**Generated:** 2026-11-21 · **Method:** read-only inspection via `scripts/recipe-data-quality.js` → raw JSON at `database-quality-raw.json`
**Scope:** local development DB (authorized read-only). No data was modified.

## Headline counts

| Area | Total | Issue | Count |
|---|---|---|---|
| IngredientCatalog | 228 (all usable) | No linked `Ingredient` (no macros) | 0 |
| | | Missing/empty category | 0 |
| | | Duplicate aliases/normalized names | 0 |
| | | Allergen-hint name, no declaration | 44* |
| Ingredient | 420 | Missing caloriesPer100g | 0 |
| | | Implausible macro value | 5* |
| | | Protein+carbs+fat > 100g/100g | **1 (real)** |
| Recipe | 258 (28 SYSTEM, 230 RESEARCH_DRAFT) | Missing/empty instructions | **150** |
| | | Meat/egg lines, no temperature guidance | **62** |
| | | Allergen-hint lines, `allergens` empty | **138** |
| | | Ingredient lines with no `ingredientId` | **55** |
| | | Invalid servings | 0 |
| Allergy (reference) | 2 | Semantic duplicate (`Peanuts`/`peanut`) | 1 |
| ConditionRule | 34 | DRAFT (inert) / APPROVED | 34 / 0 |
| HealthConditionNutrientRule | 14 | DRAFT / APPROVED | 14 / 0 |

\* flagged heuristically — see accuracy notes before treating counts as defects.

## Section findings

### 1. Catalog allergen declarations (44 flagged, partially heuristic)

`sourceRecord.allergens` is missing on items whose names strongly imply a major
allergen. **Genuine hits** (wheat family): `Whole-wheat atta flour`, `Maida
refined wheat flour`, `Semolina, dry`, `Vermicelli, wheat`, `Chapati/roti`.
**Heuristic false-positives:** `Finger millet ragi flour`, `Sorghum jowar
flour`, `Pearl millet bajra flour` — the `flour` token hints "wheat" but these
are millets; not allergens under a wheat rule.

- **Severity:** HIGH for true hits (wheat/celiac + wheat-allergy users get no
  declared-allergen protection on these items — text matching still catches
  `atta`/`maida` via `wheat` terms only if the name contains `wheat`; `atta`
  does not).
- **Fix:** tag `sourceRecord.allergens` on genuine wheat/gluten items; refine
  the hint table to exclude millet flours; add `CONTAINS_GLUTEN`
  IngredientAttribute for celiac coverage.

### 2. Recipe allergen declarations (138 recipes)

Most RESEARCH_DRAFT imports carry allergen-relevant lines (`Egg frittata`,
`Baked salmon`, `Greek yogurt`, `Cottage cheese and fruit`) with `allergens: []`.

- **Severity:** HIGH — declared allergens are a hard-filter input; absent
  declarations mean only name-text matching protects the user (which works for
  `egg`/`salmon` names but not for opaque names like `Kodi vepudu`).
- **Fix:** derive `allergens` at import from linked catalog declarations +
  name hints (derive, don't trust source); never claim allergy-free.

### 3. Missing instructions (150 recipes) + meat temp guidance (62)

150/258 recipes have no `instructions`. Of the recipes containing
poultry/meat, 62 lack any `165°F/74°C` guidance.

- **Severity:** HIGH — `INSTRUCTIONS_MISSING` (clarify) and
  `POULTRY_TEMP_UNVERIFIED` (review) will fire for all of these; they cannot
  ship as "validated". Affects: `Chicken 65`, `Andhra chicken curry`,
  `Kodi vepudu`, `Turkey meatballs with pasta`, etc.
- **Fix:** populate instructions during import QA; until then, validator
  correctly marks them NEEDS_CLARIFICATION/NEEDS_REVIEW — data work is on the
  recipe corpus, not the gate.

### 4. Unlinked ingredient lines (55)

Lines like `salmon`, `chicken breast`, `asparagus`, `vegetables`, `rice`,
`brown rice`, `cottage cheese` carry `ingredientId: null` — mostly in
RESEARCH_DRAFT recipes; the catalog (heavily Indian-staple weighted) lacks
common English staples.

- **Severity:** HIGH for allergic users (unresolved identity = block),
  MEDIUM otherwise (review). This is the dominant identity gap.
- **Fix:** extend catalog coverage for common staples (chicken, rice, salmon,
  eggs, dairy basics); relink lines on catalog growth.

### 5. Macro anomalies (5 flagged, 1 genuine)

- `GLUCOSE` — protein+carbs+fat > 100g/100g — **genuine data defect**.
- `Whey protein powder` ×2 (80g protein/100g) and dried egg whites (77–84g) —
  flagged by the >60g protein threshold but **legitimate values** for protein
  concentrates/dried whites. Threshold should be ~95g for protein powders.
- **Severity:** LOW (1 real defect) — **Fix:** correct `GLUCOSE`; whitelist
  protein concentrates or raise the protein bound.

### 6. Reference data

- `Allergy` table: 2 rows — `Peanuts` + near-duplicate `peanut` (plural
  variant; my case check didn't flag it because normalized forms differ by
  `s`). Merge and alias.
- `ConditionRule`: **34/34 DRAFT** — `ConditionRule` ingredient blocks are
  entirely inert; clinical enforcement is by design OFF until review.
- `HealthConditionNutrientRule`: **14/14 DRAFT** — nutrient limits (the new
  `limits` stage) have zero approved rules; mechanism verified via fixtures.

## Verification notes for reviewers

- All validator consequences of these gaps are **covered by tests**
  (unresolved→block/review, missing instructions→clarify, poultry temp→review).
  The gaps reduce *coverage*, not *correctness* — the system fails closed.
- This is a local/dataset snapshot; production counts must be regenerated
  with the same script against the production DB before release signoff.
- No medical/nutrition data was changed or proposed for auto-overwrite —
  every fix lists a review path.
