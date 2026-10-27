# Ingredient catalog v5 — implementation and release review

October 26, 2026. **Owner-approved v5 hosted migration/import completed; matching backend deployment succeeded. No app build or submission was triggered.**

## Existing implementation and upgrade

The hosted TestFlight database received the earlier additive migration `20261025000100_ingredient_catalog` and 684 catalog records on October 25, after a verified protected pg_dump backup. It had 120 existing Ingredient records; the import added 212 usable Ingredient links, with no name matches. The earlier catalog search release was not deployed before the v5 request superseded it. Do not confuse a successful database import with a deployed mobile/backend release.

Existing `IngredientCatalog`, `Ingredient`, `UserIngredient`, `FoodLog`, `Recipe`, and `RecipeIngredient` are reused. The old importer used normalized-name reconciliation; the v5 importer uses the stable external ID and never merges by name. All 684 earlier external IDs occur in v5. Existing Ingredient primary keys and user links remain intact. The old importer now refuses to overwrite v5 records.

Current pending C10/D03/dependency work was inspected and preserved. This task adds no destructive migration and does not modify hosted users. Deployment preparation no longer automatically reimports the obsolete JSON catalog.

## Source and CSV mapping

Authoritative input: `data/imports/humai_ingredient_catalog_v5_with_verification_labels.csv`, copied byte-for-byte from Downloads `humai_ingredient_catalog_v5_with_verification_labels (1).csv`. Earlier research/MYF files are superseded. The old JSON remains only as the earlier-import regression fixture. `data/imports/ingredient-aliases.json` adds the requested aata and ladyfinger spellings to explicit wheat/okra IDs without changing the supplied CSV or merging products.

All 65 CSV columns are preserved in `IngredientCatalog.sourceRecord`; numeric blanks become null, not zero. The ingestion parser handles BOM, quoted commas, escaped quotes, embedded newlines and CRLF; malformed rows, duplicate IDs, unsupported classifications and invalid numeric values fail before writing.

| CSV fields | Storage/use |
|---|---|
| id | Existing `IngredientCatalog.id`, linked by unique `Ingredient.catalogId` |
| name, search_aliases, category, preparation | Existing catalog columns; aliases stored as a PostgreSQL array |
| brand, restaurant_chain, market, food_type, cuisine | New searchable metadata columns |
| nutrition_verification_level | `verificationLevel`, exact supplied classification |
| confirmed_nutrients, estimated_nutrients, verification_explanation, status, confidence, original_status, label_status | Preserved source record; shown in provenance, never inferred from a URL or confidence |
| all per-100g nutrient fields | Original values retained; normalized energy/macros/fiber on Ingredient; additional available nutrients in shared calculation DTO |
| carb_definition, total_carbs_g_per_100g, total_carb_estimation, digestible_carbs_approx_g_per_100g | Original fields retained; explicitly supplied total carbs preferred; only derive available + fiber when needed and defined |
| serving_label, serving_g_assumed, serving nutrients, serving_source_basis | `IngredientServing`, with original serving profile and estimated flag; grams are explicit |
| source, source_id, source_url, reviewed_on, source_retrieved_date, notes, source_type, nutrition_revision | Source record, accessible through detail/provenance API and review script |
| allergens, parent_generic, search_priority, MYF guide fields, warnings and review fields | Original metadata retained; no invented allergens or supplement components |
| CSV + maintained alias-map SHA-256 | `importBatch` and append-only `IngredientImport` audit records |

Migration: `prisma/migrations/20261026000100_ingredient_v5/migration.sql`. Adds metadata, `Ingredient.sourceMetadata`, serving/import-audit tables, favorite/selection fields, and nullable food-log/recipe-ingredient reference and snapshot fields. Removes only the unique *name index*, allowing distinct products with the same name; ID uniqueness remains. No rows/tables are dropped. Historical reference IDs are nullable strings so stored snapshots remain usable if reference data is later retired.

## Import results and reconciliation

Verified on a disposable PostgreSQL database initialized with the earlier 684-row import:

| Result | Count |
|---|---:|
| CSV rows / unique IDs | 2,893 / 2,893 |
| Existing catalog IDs matched | 684 |
| Existing catalog records updated | 684 |
| New catalog records inserted | 2,209 |
| Skipped / identity conflicts / errors on initial upgrade | 0 / 0 / 0 |
| Total catalog records | 2,893 |
| Repeat import inserted / updated / skipped | 0 / 0 / 2,893 |
| Source-backed full | 210 |
| Partially source-backed | 32 |
| Generic composition | 17 |
| Estimated | 2,633 |
| Review conflict | 1 |

The one data-quality conflict is `HUMAI-V5-01649` (Myprotein chocolate sample); it remains `REVIEW_CONFLICT`, is flagged `reviewRequired`, and is shown as estimated/needs review. This is distinct from an identity-merge conflict. Supplied source-backed labels are metadata, not a new independent verification of the manufacturer or publication.

All complete v5 profiles can be selected, including estimates. Missing core nutrition still prevents automatic calculation. There are no missing core macros in this file. Existing non-catalog USDA/user foods remain separate. The existing reviewed weekly library imports exact USDA FDC identities into the same Ingredient table; these are additional reference foods, not duplicate Humai catalog IDs. Total Ingredient count can exceed 2,893.

The importer serializes transactions, updates by stable ID, checks changed brand/preparation/source identity, preserves usable higher-confidence records against a lower-quality replacement, and reports identity matches under different IDs for manual mapping. No automatic name-only alias merge occurs. Ambiguous entries are skipped and audited; they do not overwrite the prior row. Source updates require editing the CSV with evidence and retaining the same ID. Omission does not delete old catalog rows.

## Central services and connected features

- `src/services/nutrition.js`: quantity validation, null-preserving portion/serving/recipe math, total-vs-available carbs and actual recipe yield. No cup/tablespoon/scoop-to-gram guesses.
- `src/services/ingredientNutrition.js`: details, serving options, quantity calculations, recipe totals and provenance.
- `src/services/ingredientService.js`: catalog-first name/alias/brand/restaurant search, relevance before verification, then non-catalog personal/shared cache and USDA. Search ranks compact metadata before loading full source records for selected results.
- Food entry/typeahead: preparation and generic/branded filters, estimated/source-backed labels, favorites/recent selections, serving weights, editable quantities/macros/fiber, source and warnings. Shared React Native implementation covers iOS/Android; signed-device acceptance is still needed.
- Food logs: store submitted nutrition unchanged, reference ID, source/revision, calculated and saved values, correction flag and selection revision. Retry with the same meal ID cannot rewrite the original snapshot. History hydration retains these fields.
- User recipes: central quantity calculation and immutable source snapshot at creation. Local recipe search/nutrition precedes external prepared-recipe lookup. Unknown external serving weight is rejected rather than silently treated as 100 g.
- Weekly planning and Leo meal suggestions: the reviewed recipe library resolves exact FDC identities from the central Ingredient table and uses shared recipe arithmetic. Hardcoded recommendation macro lists were removed. Changed reviewed source values require a new recipe revision instead of rewriting an old recipe. Existing prepared recipes are not matched to raw ingredients by name.
- Trainer/nutritionist plans: referenced ingredient quantities use central calculations; manual plan nutrition remains explicitly supplied data.
- Label scans: label serving grams use shared calculation functions and store user-reviewed label provenance. A scanned product is not automatically merged into a similarly named branded catalog row.
- Nutrition scores, progress and Leo context consume saved meal snapshots; imports never recalculate historical logs.

AI photo/text identification and independent scanned labels remain estimates/observations. They are not evidence that a similarly named catalog item is the same SKU/preparation. This upgrade does not automatically replace those observations or claim medical/allergen safety.

## API

All routes require the existing verified account session:

- `GET /ingredients/search?q=...&preparation=raw&productType=branded&verificationLevel=ESTIMATED` (filters optional).
- `GET /ingredients/:id`: nutrients, servings, provenance and verification.
- `POST /ingredients/:id/nutrition`: `{ "grams": 150 }` or `{ "servingId": "...", "count": 2 }`.
- `POST /ingredients/recipe-nutrition`: `{ "ingredients": [{ "ingredientId": "...", "grams": 100 }], "yieldGrams": 250 }`.
- `PUT /ingredients/:id/selection`: `{ "favorite": true }`; false removes favorite, absent records a selection.
- `GET /ingredients/selections?favorite=true`: own favorites; omit/false for recent selections.
- `POST /recipes`: own recipe name, ingredient IDs/grams and optional explicit yield.
- Existing `/recipes/search`, `/recipes/:id/nutrition`, `/food-logs` remain supported; food logs accept optional `ingredientId`, `catalogRevision`, `selectedServing`.

USDA uses a backend-only key, two bounded attempts with backoff, a five-second timeout per attempt and sanitized unavailable errors. Local results do not call USDA. Cached results retain FDC ID, data type, serving metadata, nutrient definitions/provider and retrieval timestamp. Missing upstream macros are not fabricated as zero. Existing curated records are not deliberately overwritten by USDA lookup.

## Data limitations and licensing

1. 1,769 source rows use a mixed description (“100 g ... or ~100 mL”). Original basis and warnings remain visible. Calculations use the supplied per-100g estimate and explicit grams; no liquid density is inferred. Users must review the estimate/label. These rows need source-specific mass/density review before being described as precise measurements.
2. Calories and rounded macro energy need not match; source calories are preserved rather than replaced with 4/4/9 arithmetic.
3. A source-backed classification may still have derived total carbohydrate. The conversion explanation is shown separately.
4. USDA FoodData Central identifies its data as public-domain/CC0: https://fdc.nal.usda.gov/api-guide/ . The IFCT publication carries NIN copyright: https://www.nin.res.in/ebooks/IFCT2017.pdf . A GitHub transcription is not proof of commercial redistribution rights. IFCT permissions and manufacturer/menu/MYF source reuse terms remain unconfirmed; public commercial release must not describe this review as license clearance. No source licenses are inferred from HIGH confidence or a URL.

## Maintenance and commands

Use Node 22 and set `DATABASE_URL` securely outside shell history/documentation. Preview is the default. The import script is `scripts/import-ingredients-v5.js`.

Disposable/staging database rehearsal:

```sh
npm run db:generate
npm run db:deploy
npm run ingredients:import:v5
npm run ingredients:import:v5 -- --apply
node scripts/review-ingredients.js REVIEW_CONFLICT
node scripts/review-ingredients.js ESTIMATED
```

For a non-local staging database, `--approved-hosted` is also required; it is an explicit guard, not a substitute for verifying the target and authorization. The checked-in default path is the v5 CSV. An alternative file path can be passed to support future revisions.

After explicit owner approval of the hosted change, take and verify a fresh protected backup, inspect migration state/current counts, then:

```sh
npm run db:deploy
npm run ingredients:import:v5
npm run ingredients:import:v5 -- --apply --approved-hosted
npm run ingredients:import:v5
```

The apply command also ensures the exact reviewed weekly USDA cache exists without overwriting existing source records. Catalog import and this cache preparation are separate transactions; a cache failure does not undo an already committed catalog import. Resolve it and rerun safely. Deployment must include the matching schema/client/backend changes; database import alone does not activate the new search behavior. No EAS build/submission is part of this task.

Edit the maintained CSV, retain IDs, and add source evidence before promoting a verification classification. Do not delete old IDs to rename products. `IngredientImport` contains checksum, filename, counts/conflicts and time for each applied run. Default serving records owned by the changed catalog entry are replaced transactionally; custom serving records are retained. Review conflicting IDs explicitly before any merge. Do not manually edit live nutrition as the maintenance workflow.

## Verification

- Backend unit/regression suite, authenticated account suite, mobile suite and TypeScript checks recorded in the handoff.
- `scripts/test-ingredient-v5.js`: isolated PostgreSQL upgrade, stable old IDs, repeat imports, classification counts, local examples, gram/serving/yield calculations, source precedence, identity conflicts and historical preservation.
- `scripts/test-ingredient-v5-api.js`: real verified-session requests, unauthorized rejection, invalid quantities, repeated favorites and food logs, correction snapshots and user recipes.
- Reviewed recipe check: 12 library recipes resolve exact central FDC sources and retain their established totals.
- Hosted v5 writes were approved and applied. No app build/submission or real-user record mutations were performed.


## Approved hosted rollout — October 26, 2026 (EDT)

- Protected PostgreSQL custom-format backup verified before migration: `/private/tmp/humai-before-v5-20261026-124504.dump` (253,682 bytes, permissions 0600).
- Migration `20261026000100_ingredient_v5` applied successfully. All 23 migrations are applied.
- Hosted import: 684 matched/updated, 2,209 inserted, 0 skipped/identity conflicts/errors; 2,893 catalog rows. Repeat preview: 0 inserted, 0 updated, 2,893 unchanged. Verification classifications match the CSV exactly.
- 3,022 total Ingredient records include the preserved existing USDA cache and reviewed recipe reference foods. All previous Ingredient IDs and catalog links were preserved.
- Before/after fingerprints of original user, meal, selection and plan data matched; comparisons omit newly added null/default columns. Twelve new shared reviewed recipes were initialized; existing user recipes were not changed (none existed at rollout).
- The older FDC chicken cache had rounded macros and missing fiber. Its lookup values remain unchanged. Exact reviewed recipe nutrition is stored as a named source revision in the same Ingredient's `sourceMetadata.reviewedProfiles`. Recipe calculations bind to this revision; later USDA cache refreshes retain it. A local regression and hosted checks verified all 12 recipe sources.
- Hosted read-only catalog checks passed for aata, ladyfinger, bajra, Amul milk, Jif peanut butter and Chick-fil-A Sauce without USDA calls.
- Isolated backend release based on deployed commit `e468762`, with the catalog changes only: `/private/tmp/humai-v5-release-msp3ut3f`. Its 284 tests / 33 suites passed. Unrelated pending C10/D03/dependency changes were excluded. This CLI deployment does not push local Git changes.
- Railway deployment: `f98cd31b-9b81-4610-8c58-710a33395403`; SUCCESS. Public `/health` returned HTTP 200; unauthenticated catalog search and selections correctly returned HTTP 401. Authenticated deployed-client acceptance remains a separate check.
- New mobile controls/verification presentation remain local and require a later app release. No EAS build or TestFlight submission was triggered. Live authenticated client acceptance still requires an existing signed-in test session; no real user's account/session was modified to impersonate them.
