# §9 USDA Governance — Batch-Review Handoff (pc-HUM-36)

**Scope:** the 40 test-imported `IngredientNutritionProfile` rows on isolated `fitness_test` (none production). **Audit date:** 2026-11-26. **No review decisions fabricated** — every row awaits a human reviewer; nothing here is an approval.

## Population verified (real-DB probe)

| Dimension | Result | Governance reading |
|---|---|---|
| Total profiles | 40 | matches the card's test-import population |
| `verifiedAt` set | **0** | correct — import never auto-verifies; source association ≠ human verification |
| Missing `sourceFoodId` (FDC) | 0/40 | every row traceable to an FDC record |
| Orphan profiles (no ingredient) | 0/40 | referential integrity intact |
| Empty citation/recordKey | 0/40 | provenance complete |
| Non-canonical units | 0 violations | g/mg/mcg/kcal only — no IU/DFE leakage (canonical-master invariant) |
| Distinct ingredients | 40/40 | exactly one profile per ingredient — no conflicts |
| **`preparationType`** | **40/40 `OTHER`, `preparationMethod` all NULL** | **primary governance gap — raw/cooked/serving basis unclassified** |
| Source mix | USDA FDC Branded + Survey (FNDDS) | mixed — reviewer must judge per-record applicability |

## Findings for the reviewer

1. **G-1 (blocking for approval): raw/cooked basis unclassified.** Every profile is `preparationType=OTHER` with no method. A reviewer cannot confirm whether per-100g values describe the food as consumed (e.g. cooked rice dressing) or as sold. **Batch action: classify raw vs cooked per row before any approval** — values for FNDDS survey rows are generally as-consumed; branded rows as-sold. No auto-classification was applied — inference would fabricate evidence.
2. **G-2: added sugar / inferred nutrients.** Profiles carry only what the source record states — nulls stayed null at import (`nutrientImport` rejects absent data rather than estimating). Reviewer must not treat missing added-sugar rows as zero-sugar evidence.
3. **G-3: branded-record applicability.** Branded FDC rows (e.g. glucose tablets fdcId 1842171) describe one manufacturer's product — approving them as generic-composition evidence needs an explicit reviewer note.
4. **G-4: no conflicts detected** — one profile per ingredient, so no competing-version adjudication is needed in this batch.

## Reviewer workflow readiness (verified in main)

`src/routes/nutritionReview.js` (super-admin secured): APPROVE/REJECT/REQUEST_CHANGES with mandatory justification (≥10 chars), optimistic concurrency (409 on concurrent decision), revoke-first rule for re-review, immutable `auditLog` trail, independent of clinical rule states. Rematerialization (`nutrients/population.js`) cannot overwrite verified rows: value conflicts route to `REVIEW_REQUIRED`; identical re-imports are `ALREADY_IMPORTED` no-ops. Tests: `nutritionReview.test.js` 8 + `nutrientPopulation.test.js` 8 + `nutrientImport.test.js` — **48/48 pass on main**.

## Batch procedure for the reviewer

1. Pull the 40 rows by `sourceDataset='usda_fdc_usda-preview-1'`.
2. Per row: classify preparation (G-1), confirm the FDC record matches the ingredient identity, check per-100g plausibility against the source record.
3. Decide APPROVE / REJECT / REQUEST_CHANGES with justification citing the FDC record.
4. Re-running `populate-nutrients` afterwards is safe — decisions survive (verified-value conflict guard).
