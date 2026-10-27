# Humai ingredient catalog

Implemented October 25, 2026. **Superseded by [the v5 upgrade](INGREDIENT_CATALOG_V5.md). The original 684-row hosted import succeeded after login renewal; the approved v5 hosted import and matching backend deployment are complete.**

## Storage and source of truth

The three owner-provided Downloads files describe the same 684 records: JSON, SQLite and CSV were compared field by field (CSV numeric/empty cells normalized). Do not import all three separately.

The maintained import source is `fitness-app-backend/data/humai-ingredients.json`, copied from `humai_ingredients_seed.json`. Keep source records in version control. The SQLite file is an interchange copy, not the live app database.

PostgreSQL tables:

- **`IngredientCatalog`**: one row per stable catalog ID (`IFCT-A003`, etc.). Stores name, unique normalized name, normalized aliases, category, preparation, supplied status, derived `usable` flag, original full source record and update timestamp. `sourceRecord` preserves cuisine, source citation/URL, source ID, original nutrients, carbohydrate definition and notes.
- **`Ingredient`**: existing app-wide ingredient table. Each usable catalog record links to exactly one ingredient via unique `catalogId`; no separate competing food cache is introduced. Existing exact-name matches retain their ingredient IDs, user links and safety attributes. Ambiguous multiple existing matches abort the entire import for review. USDA IDs remain USDA IDs; the column now permits null for non-USDA sources.
- **`UserIngredient`**: existing user cache; catalog search runs before it. Existing user records are preserved.

Schema migration: `prisma/migrations/20261025000100_ingredient_catalog/migration.sql`. It adds the catalog table, unique constraints, `Ingredient.catalogId` and `fiberPer100g`, and makes `fdcId` optional. Existing nutrition columns and historical meal records are not rewritten.

Local verification database: `127.0.0.1:55439/fitness_catalog_20261025`. This is isolated test data, not Railway. The intended hosted target is the existing Railway PostgreSQL used by the TestFlight backend; the original 684-row catalog/212 usable ingredient import was applied after a verified backup.

## Which records are usable

Owner decision: hide incomplete records; catalog first, USDA fallback.

- 684 records retained.
- **212 usable** with complete calories/protein/carbohydrate/fat and required carbohydrate-conversion data.
- **472 hidden**: 449 explicitly `NEEDS_SOURCE_MATCH`, plus 23 other records missing at least one required nutrient or fiber needed for conversion.
- Missing values remain null. They are never interpreted as zero. A status label alone does not qualify a record.
- Generic and identity-derived complete compositions are available, with their status retained; mobile search identifies them as estimated composition. Supplied citations are preserved; this import is not an independent laboratory verification.

The app uses total carbohydrate. For records explicitly marked IFCT available carbohydrate **excluding fiber**, the app value is available carbohydrate + fiber; the original stays unchanged in `sourceRecord`. Example: bajra 61.78 g available carbohydrate + 11.49 g fiber = 73.27 g total carbohydrate per 100 g. Calories remain the supplied calories and are not recomputed from this conversion.

## Search and affected features

`GET /ingredients/search?q=...` remains the authenticated entry point. Catalog names and aliases are ranked exact match, prefix, then token-containing match, with deterministic ordering. For example `bajra`, `sajjalu`, `kambu` and `pearl millet` resolve to the same catalog ingredient. Query length and result limits are bounded.

If there is no usable catalog match, the existing non-catalog personal/central cache and USDA fallback are used. USDA results cannot deliberately replace a linked curated record through normal subsequent lookups. Search does not leak hidden catalog records through old personal cache links.

Food entry receives the same per-100g DTO, now including fiber, preparation and provenance. Portion scaling, saved meal nutrition, daily totals and downstream features reading those saved values use the selected catalog numbers. Typeahead debounce and stale-response protection work in the shared iOS/Android component. Older binaries can read the existing numeric fields; preparation/provenance presentation requires the updated app binary.

Historical meal snapshots are intentionally preserved. AI photo/text estimates, branded label scans and externally sourced prepared recipes are distinct measurements, not automatically overwritten by a similarly named raw ingredient. Reviewed weekly recipes retain their exact USDA/preparation-specific source data when no precise catalog mapping exists. Do not substitute raw grains for cooked recipe grams or infer allergies/medical safety attributes from this nutrition list. This task does not claim to replace every external recipe or AI data source.

## Add or correct ingredients

1. Edit `data/humai-ingredients.json`; use the same object fields as existing records.
2. Assign a new permanent unique ID for a new food/preparation. To correct an existing item, keep its ID. Never change an ID just to rename a food.
3. Set the exact preparation, a supported `100 g`/`100 g edible portion` basis, finite nonnegative nutrition values, carbohydrate definition and source attribution. Use semicolon-separated search aliases. Leave genuinely unknown nutrients null and keep the item pending until sourced.
4. From the backend with Node 22 and the intended database set securely in `DATABASE_URL`, run:

   ```sh
   npm run db:deploy
   npm run ingredients:import
   ```

   The second command previews counts and name conflicts without changing rows. Confirm the target database independently; never paste a connection URL with credentials into documentation or chat.
5. After reviewing the preview, apply:

   ```sh
   npm run ingredients:import -- --apply
   ```

6. Search the food's full name and aliases, verify preparation, per-100g nutrition and a weighed portion, then update source documentation. For deployment, `deploy:prepare` imports the catalog after migrations/RBAC and before final readiness verification.

Imports validate before writing, run in a transaction, serialize concurrent importers, and upsert by catalog ID. Repeating the import preserves IDs and record counts. A source failure or ambiguous name rolls back all import changes. Correcting a matched existing ingredient updates its current lookup nutrition; it does not modify old meal snapshots.

Omitting an item from the JSON does **not** delete it. To retire it from search, keep its stable ID and change status to `NEEDS_SOURCE_MATCH`; any existing linked Ingredient remains for references but is excluded from lookup. Physical deletion/merging requires a separately reviewed reference migration. Common-name aliases are not sufficient proof to merge USDA foods with distinct preparation states.

## Verification and deployment checklist

- 302 backend tests / 35 suites; 37 authenticated integration tests.
- 198 mobile tests / 46 suites; TypeScript and shared platform exports passed.
- Real PostgreSQL checks: preview has no writes; repeated and simultaneous imports retain 684 catalog / 212 ingredient rows and stable IDs; all 212 exact names resolve; aliases/case/ranking, fiber/total carbohydrate, update/retirement, duplicate validation and USDA fallback/cache behavior pass.
- Typeahead tests cover debounce, stale response rejection, preparation display and unchanged selected nutrient values.
- Account export/deletion coverage classifies `IngredientCatalog` as shared reference data.
- No real user records were changed. The original hosted schema/import completed; catalog endpoint deployment was superseded by v5 before it occurred. Signed native-device acceptance remains separate from JS export/tests.

Use the v5 maintenance guide for further changes. The earlier JSON importer refuses to overwrite v5 rows. The approved v5 hosted changes are complete; no new app build was performed.
