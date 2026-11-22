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

---

## 8. Follow-up audit — dal basis investigation + recipe consistency (this task)

### 8.1 The "dal = 17 g/100 g" report — investigated

The assistant's earlier answer came from `Chana dal split chickpea, dry`
(`fiberPer100g: 17`, source `humai-catalog`, serving cup=200 g, tbsp=12.5 g).
Finding: **the value is correct for the record it belongs to** — it is a
*dry-split-legume* basis figure, consistent with USDA dry-chickpea-family
values. The defect was in the answer path, not the data: a generic "dal"
question was resolved to one alphabetically-first dry-basis row and reported
without a preparation qualifier, which could read as "cooked dal has 17 g
per 100 g" (actual cooked dal ≈ 3–8 g/100 g; the seed recipes show 5–10.4 g
per serving — see 8.2).

All catalog rows matching /dal/ are dry-basis — **no cooked/prepared dal
ingredient row exists**:

| Ingredient | fiber/100 g | basis | source |
|---|---|---|---|
| Urad dal split, dry | 18 | dry | humai-catalog |
| Chana dal split chickpea, dry | 17 | dry | humai-catalog |
| Moong dal yellow, dry | 16 | dry | humai-catalog |
| Toor/arhar dal, dry | 15 | dry | humai-catalog |
| Masoor dal red, dry | 10.7 | dry | humai-catalog |
| Brown lentils (dry) | 10.7 | dry | humai-catalog |

Cooked legume rows exist only for non-dal beans (chickpeas 7.6, rajma 6.4,
kala chana 7.6, black beans 8.7, pinto 9, cannellini 6.3) and USDA
"Lentil curry" 3.4 / "Lentil curry with rice" 2.2 — all `humai-catalog` or
`usda`.

**Code fix applied (not a data change):** `assistant.js` now detects when a
food phrase resolves to multiple dry-basis variants and answers with the
explicit range + dry-weight caveat ("cooked portions have far less per
100 g; a logged recipe's per-serving value is the number that counts").
Single-row matches carrying dry/uncooked markers get a basis note.
Raw-named rows (e.g. "Broccoli, raw") are NOT treated as dry-basis — raw
vegetables are eaten raw. Duplicate catalog names collapse before ranging.

### 8.2 Recipe-level fiber consistency (258 recipes checked)

Recomputed `Recipe.fiberG` per serving from ingredient lines ×
`Ingredient.fiberPer100g`:

- **220/258 consistent** (within ±1.5 g or ±25% of computed)
- **6 mismatches** — all `SYSTEM` meal-template recipes where stored per-
  serving values diverge from line sums (recorded, NOT modified):
  - Lentil soup with bread: stored 12 vs computed 19.7
  - Greek yogurt with granola: stored 3 vs computed 5.6
  - Eggs and whole wheat toast: stored 3 vs computed 7.0
  - Salmon with quinoa: stored 5 vs computed 2.8 (overstated)
  - Avocado toast with egg: stored 6 vs computed 11.7
  - Overnight oats: stored 8 vs computed 16.2
- **32 recipes unresolvable** — one or more lines have no linked ingredient
  fiber (honest unknowns; e.g. condiment lines)
- Indian dal recipes verified consistent: Moong dal 8.0, Dal tadka 8.0,
  Dal makhani 10.4, Masoor dal 5.5, Moong dal khichdi ~4.6→5 — all per
  serving, all `RESEARCH_DRAFT` (appropriately unverified status)

Recommendation for catalog owners: the 6 SYSTEM recipes' `fiberG` values
look like curated estimates that drifted from their ingredient sums;
either accept the line-sum (preferred — keeps per-serving consistent with
composition) or correct the line amounts. **No values were modified.**

#### 8.2.1 Root-cause analysis of the six mismatches (2026-11-23)

Each recipe's lines recomputed against the live catalog; servings=1 on all
six, so computed total = per-serving. Common root cause across all six:
`Recipe.fiberG` is a **manually-stored snapshot never recomputed from
`RecipeIngredient` lines** — drift accumulates from recipe edits and
portion-basis confusion (dry vs cooked, per-serving assumptions).

| Recipe | Stored | Authoritative (line-sum) | Likely cause |
|---|---|---|---|
| Lentil soup with bread | 12 | 19.7 (lentils 150g×10.7 + bread 100g×3.6) | Stored looks like soup-only with a cooked-lentil basis (~8/100g × 150g ≈ 12); bread line likely added after the snapshot |
| Greek yogurt with granola | 3 | 5.6 (granola 80g×7) | Stored assumes ~40g granola or a lower-fiber granola row |
| Eggs and whole wheat toast | 3 | 7.0 (bread 100g×7) | Stored matches ~1 slice (45g) or white-bread data, not the 100g line |
| Salmon with quinoa | 5 | 2.8 (quinoa 100g×2.8) | **Overstated**: stored used dry-quinoa basis (~7/100g) against a cooked-weight 100g line — this direction is the risky one (app would overstate confirmed fiber) |
| Avocado toast with egg | 6 | 11.7 (avocado 70g×6.7 + bread 100g×7) | Stored counts avocado only, or a half-serving of bread |
| Overnight oats | 8 | 16.2 (oats 120g×10.6 + chia 10g×34.4) | Stored matches a ~60-75g single-serve oats assumption; the 120g dry line may itself be oversized — needs owner judgment on which side is wrong |

Safety impact: low-to-moderate. Under-statements under-report confirmed
fiber (conservative for recommendations); the salmon-quinoa
over-statement is the only direction that inflates recorded intake.
Corrective proposal (not applied): recompute `fiberG` from lines at
recipe-write time or backfill `RecipeIngredient.fiberG` per line so drift
is detectable per ingredient rather than per recipe.

### 8.3 Other findings

- `RecipeIngredient.fiberG`: 0/1714 rows populated (column added this
  release; engine falls back to `ingredientId`→`Ingredient.fiberPer100g`).
- `IngredientNutrient` FIBER rows: only 18 — the per-preparation profile
  path is nearly empty; flat `fiberPer100g` is the operative store
  (409/430 present, 21 NULL).
- Serving conversions: 240/430 ingredients have NO `IngredientServing`
  row — portion math falls back to raw grams (honest, but cups/tbsp UX
  degrades to weight entry).
- Two >50 g/100 g rows — `Cinnamon powder` 53, `Spices, curry powder` 53.2
  (usda). **Verified plausible**: these are USDA-accurate spice values used
  in gram amounts; flagged here to prevent a future "correction" mistake.
- No `fiberPer100g < 0` rows; no serving rows with `grams <= 0` among dal.

### 8.4 Data-quality invariants reaffirmed

- Dry-basis values must never be presented as cooked/served values — now
  enforced in the assistant path; sequencing uses component roles +
  per-100 g only for "meaningful fiber" thresholds, where dry legumes
  correctly qualify as fiber-rich.
- Recipe `fiberG` remains per-serving; `RESEARCH_DRAFT` status honestly
  communicates verification state.
