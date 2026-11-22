# USDA IMPORT — APPROVAL MANIFEST (Phase 3)

## Credential + connectivity status

- `USDA_API_KEY` present in `.env` (owner-provisioned, never printed).
- Live dry-run verified: `scripts/fetch-nutrient-sources.js` fetched **10/10** fdcIds to a local file cache — zero failures, zero app-DB writes, rate-limited batches (20/request, 1s pause, honors `x-ratelimit-remaining`).

## What the dry-run proved (and did NOT do)

- Source records are fetchable, cached atomically (`.tmp`→rename), keyed by fdcId, with `retrievedAt` + endpoint provenance.
- **No application tables were touched.** No ingredient profiles were created, updated, or marked verified.

## Current catalog state (read-only audit)

- 420 ingredients; 18 with verified nutrition profiles; ~145 have `fdcId` links (proxy candidates); remainder estimated/missing.
- All 228 catalog rows currently `GENERIC_COMPOSITION` source class.

## Proposed import contract (for owner approval)

| Rule | Enforcement |
|---|---|
| Exact-match only | Ingredient must already carry `fdcId` (human-confirmed linkage). No name-fuzzy auto-matching in this batch. |
| Missing nutrients stay null | `usdaService.nutrient()` returns null, never 0. |
| Added sugar not inferred | Never derived from total sugar. |
| Proxy ≠ verified | Records land as `source: usda_fdc` with verification status `proxy_verified_source` only when nutrient fields are present; identity match review stays manual. |
| Provenance | Every profile stores fdcId, dataType, retrievedAt, source endpoint, dataset version where available. |
| Conflicts | Existing non-null values are never silently overwritten — conflicts reported, not resolved. |
| Preparation state | Raw/cooked and form distinctions preserved; mismatched-state FDC entries are flagged `review_required`, not imported. |

## Import preview plan (runs on approval)

1. `ingredient-verification-backlog.js` → ranked candidate list (fdcId present, unverified profile).
2. `fetch-nutrient-sources.js` → fill local cache for candidate fdcIds (rate-limited).
3. Diff pass (read-only): computed per-100g USDA values vs stored profile → preview file with rows_inserted / rows_updated / unchanged / conflicts / ambiguous / FK impacts on recipes + historical logs / coverage delta.
4. Owner reviews preview → authorizes target DB (`fitness_test` first, never production).
5. Apply via versioned script with `verifiedAt` left NULL until reviewer sign-off on the identity mapping.
6. Rollback: profiles written under a new `sourceBatch` tag — deleteMany on that tag restores prior state; ingredient rows untouched.

## Required owner decisions

- [ ] Authorize writes to `fitness_test` (staging-safe) for the preview batch
- [ ] Approve `fdcId`→ingredient identity-matching process (manual vs assisted)
- [ ] Decide whether `proxy_verified_source` may render as "USDA-sourced" in UI or stays unlabeled until review
- [ ] Production import timing (separate authorization)

## Dry-run preview counts (read-only, computed 2026-11-22)

Dev catalog (`fitness_app`, read-only query — NO writes performed):

| Metric | Count |
|---|---|
| Total ingredients | 430 |
| fdcId-linked | 186 |
| Already verified profile | 11 |
| **Preview batch (fdc-linked, unverified)** | **175** |
| Of those, macro-complete on row | 175 (conflict-check still required vs USDA values) |

Preview write plan (on authorization): `insert` = 175 `IngredientNutritionProfile` rows (`source: usda_fdc`, `verifiedAt: NULL`, `sourceBatch: usda-preview-1`); `update` = 0 ingredient rows; `skip` = rows where USDA per-100g conflicts with stored values → `review_required` list (computed at fetch-diff time, est. 5-15%); `flag` = prep-state mismatches.

**AUTHORIZATION REQUEST (exact):** "Approve inserting up to 175 `IngredientNutritionProfile` rows (unverified, `sourceBatch: usda-preview-1`) into **fitness_test only** using exact existing fdcId mappings; no updates, no fuzzy matches; rollback = deleteMany on sourceBatch tag. Production unaffected."
