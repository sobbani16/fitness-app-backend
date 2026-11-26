# Serving-coverage recount — pc-HUM-51 Workstream B (2026-11-26, dev DB read-only)

Reproducible: `node scripts/audit-serving-coverage.js` (read-only, exits 2 on error, never writes).

## Denominator (explicit, no hidden games)
- DENOMINATOR = `usable:true` IngredientCatalog rows = **228**
- NUMERATOR = rows whose linked Ingredient carries >=1 IngredientServing = **190**
- Coverage = **83.3%**; serving rows = **422** — the historical "228/190/83.3%/38/422" leads are CONFIRMED as current real state, not stale.

## Quality gates (all clean)
- badGrams (grams<=0): **0** — no invalid conversions
- weight-unit pseudo-servings: **0** — no weight/volume units posing as servings
- missing sourceRecord provenance: **0** — every serving traceable
- duplicate labels per ingredient: **0**
- estimated share: 0% (all rows carry explicit source provenance)

## Findings
- **F-1 frequently-logged linkage broken**: only **1 of the top-50 most-logged ingredientIds** matches a usable catalog row. FoodLogs overwhelmingly reference ingredients outside the usable-catalog denominator — the "frequently-logged coverage" metric cannot be honestly computed until the catalog↔ingredient↔foodlog linkage is audited. This is a provenance/linkage gap, not a coverage-game.
- **F-2 category taxonomy case-inconsistent**: `Vegetable` (25 rows) vs `vegetable` (12) are distinct categories — fragmentation distorts per-category coverage. Same pattern likely elsewhere; normalization pass needed (with migration, not silent rewrite).
- **F-3 proxy-named catalog entries in unresolved queue**: `curry leaves fresh — proxy`, `goat meat lean, raw — proxy`, `gongura sorrel leaves, raw — proxy`, `ivy gourd dondakaya, raw — proxy`, `jaggery unrefined sugar — proxy`, `ridge gourd beerakaya, raw — proxy` carry "— proxy" in their catalog names — prior imports proxy-mapped distinct foods. Per the card, proxy foods are forbidden for servings; these rows are correctly unresolved (no fabricated conversion exists) but the naming itself advertises a proxy identity that a data owner should adjudicate (rename vs re-source).

## Unresolved queue (38, complete, dynamically discovered)
arborio rice (dry), baking powder, berbere spice blend, cashew nuts raw, cocoa powder unsweetened, cream cheese, curry leaves fresh — proxy, dill fresh, dumpling wrappers, espresso (brewed), fenugreek leaves methi raw, finger millet ragi flour dry, flattened rice poha dry, glutinous (sticky) rice dry, goat meat lean raw — proxy, gongura sorrel leaves raw — proxy, ground beef raw (85% lean), hummus generic, imitation crab (surimi), ivy gourd dondakaya raw — proxy, jaggery unrefined sugar — proxy, jerk seasoning blend, lamb raw lean, lasagna sheets (dry), paneer reduced-fat plain, potato boiled, rice noodles (dry), rice basmati cooked, ridge gourd beerakaya raw — proxy, shrimp prawns raw, soba noodles (dry), soy chunks dry unbranded, taco seasoning blend, thai red curry paste, tofu firm plain, turmeric powder, vermicelli wheat dry, whole-wheat atta flour dry.

Matches the card's named examples (atta, cashew, basmati, paneer variants, soya chunks, ragi, poha, gongura, tindora/ivy gourd). Resolution rules per the card: USDA FDC portions or documented measurement only; dry≠cooked; per-100g ≠ serving weight; unverifiable → review queue + weight fallback, never fabrication.

## Coverage by category (top)
Vegetable 88% (22/25), Grains 71.4% (10/14), condiment 92.3% (12/13), Fruit 100% (12/12), vegetable 100% (12/12), Spices 90.9% (10/11), Legumes 100% (9/9). Grains is the weakest major category — consistent with the dry-vs-cooked noodle/rice/vermicelli cluster in the unresolved queue.

## B4 import-pipeline assessment (`scripts/import-ingredient-servings.js`, existing)
Already: dry-run default, `--apply` opt-in, USDA-verified foodPortions only, sane() mismatch rejection, needs-human reporting, per-catalog-id targeting. Gaps vs B4: no batch checkpointing/reversibility manifest, no transactional batching, no before/after report artifact, no rate-limit retry backoff evidence, idempotency unverified by test. Hardening is follow-up scope; do not run `--apply` on shared dev DB without explicit approval (card constraint).
