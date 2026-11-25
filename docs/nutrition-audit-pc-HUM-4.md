# Nutrition Intelligence Audit — pc-HUM-4

**Iteration:** discovery + documentation only. No rule, scoring, or data changes were made.
**Date:** 2026-11-24 · **Branches:** backend `humai/dev-03-pc-HUM-4-nutrition-audit` (from `security/master-audit-remediation`), mobile `humai/dev-03-pc-HUM-4-nutrition-audit` (from `security/master-audit`)
**Environment:** local dev Postgres (`fitness_app`) — ~2,400 test users; findings describe schema+seed/dev-data behavior, not production certification.

## Scope
- Catalogs: foods, ingredients, recipes, barcode products, supplements (macros/micros).
- Safety rules: condition rules, nutrient thresholds, allergen screening, calorie safety, supplement interactions.
- Unit handling: per-100g normalization, servings, g/mL/oz/IU, mg/µg conversions.

## High-Level Architecture

Two parallel nutrition representations:

1. **Flat per-100g macros** — `Ingredient.{calories,protein,carbs,fat,fiber}Per100g` (legacy, powers food logging + scaling).
2. **Canonical nutrient graph** — `IngredientNutritionProfile` (per preparation, `verifiedAt`-gated, full provenance: `sourceDataset`/`sourceRecordKey`/`sourceCitation`) → `IngredientNutrient.amountPer100g` (Decimal 18,9) → `Nutrient` (27 definitions in `src/services/nutrientMaster.js`: g/mg/mcg units only — RAE, alpha-tocopherol, total folate; **no IU/DFE identities by design**).

Rule layers:
- `ConditionRule` (attribute-based block/warn + clinical lifecycle `DRAFT→APPROVED` with separate `activeAt` activation).
- `HealthConditionNutrientRule` (nutrient thresholds, `thresholdBasis` PER_SERVING/PER_100G/DAILY/OTHER, evidence-linked to `RuleEvidence`).
- `IngredientAttribute`/`SupplementAttribute` (e.g. HIGH_SODIUM, CONTAINS_GLUTEN) — the matching substrate rules target.
- `UserAllergy`/`Allergy` — the working allergy path (separate from conditions).
- `SupplementInteractionRule` / `SupplementRule` — supplement timing/interactions (all unapproved).
- `calorieSafety.js` — inactive per-user calorie-floor proposal (0.8×BMR; condition opt-outs → `clinician_review_required`); not wired to any route.
- `safety/nutritionValidator.js` — meal-level heuristic warnings (1.3× calorie, 1.5× carb/fat target multipliers).
- `nutrientCompleteness.computeUnknowns` — tracks which nutrients are unknown per log (`unverified` semantics; unknown ≠ 0).

Units:
- Canonical storage is **grams + per-100g** everywhere (`FoodLog.quantityG`, `RecipeIngredient.amountG`, `IngredientServing.grams`).
- `normalizeAmount` (`src/services/nutrientImport.js`) converts g↔mg↔mcg (µg/μg/ug aliases) and kJ→kcal; **rejects IU** and non-mass units; requires `PER_100_G` edible-portion basis (no volume or dry→cooked conversion).
- `scripts/import-ingredient-servings.js` — weight-unit labels (`oz|lb|g|kg|ml|fl oz`, incl. `ONZ`/`GRM`) rejected as pseudo-servings; household labels only, full USDA `sourceRecord` provenance.
- `ingredientService.derivedServings` — catalog servings first (weight-unit labels sorted last), falls back to USDA `householdServingFullText` when `servingSizeUnit ∈ {g,gm,ml}` — **mL treated 1:1 with grams**.
- Mobile `foodCalories.ts` — per-100g scaling, preserves `fiber_g == null` (null-aware). `labelPortion.ts` treats `g` and `ml` identically. `FoodEntryScreen` offers serving units + g + **weight oz (28.3495 g)** — no mL option.

## Catalogs & Data Sources (dev DB, re-verified 2026-11-24)

| Entity | Count | Notes |
|---|---|---|
| Ingredient | 426 | 186 USDA fdcId, 228 humai-catalog, 10 seed, 10 test-fixture |
| IngredientCatalog (usable) | 228 | all `GENERIC_COMPOSITION` |
| IngredientServing | 422 | 190/228 usable items covered (83.3%); USDA `sourceRecord` provenance |
| IngredientNutritionProfile | **18** | micronutrients for 4.2% of ingredients |
| Nutrient | 27 | macros + minerals + vitamins |
| IngredientAttribute | 22 | ~21 ingredients classified |
| Recipe | 258 | 230 RESEARCH_DRAFT; **all 258 now `isSystem=true`** |
| RecipeIngredient | 1,714 | 17 lines lack `ingredientId` (all in SYSTEM recipes) |
| FoodLog | 323 | 260 (80%) missing `nutritionSnapshot` (legacy/voice) |
| ConditionRule / HealthConditionNutrientRule | 34 / 14 | **100% DRAFT** |
| RuleEvidence | 21 | 9 test fixtures |
| BarcodeProduct | **4** | was 0 on 11-22 |
| Supplement* | 207 | published 33 / candidate 88 / review_only 85 / archived 1; 47 interaction rules unapproved |

## Safety Rules

- **Where defined:** `data/condition-rules/` + `conditionRuleImport.js` (gated import with `applicabilityCriteria`/threshold-basis validation); attribute rules on `ConditionRule`; nutrient rules on `HealthConditionNutrientRule`; supplement rules in `data/imports/humai_supplement_safety_rules_47_draft.csv`.
- **How applied:** every consumer (`ingredientValidator`, `constraints.js`, `mealSuggestion`, `conditionEvaluation`, supplement `safetyEngine`) filters to `APPROVED`/published rules → **all condition-aware filtering is currently inert** (conservative-by-construction; zero clinical output today).
- **Allergy screening** is the one live personalized path (`UserAllergy` + recipe `allergens[]` + suitability endpoints).
- `conditionEvaluation` converts clinician thresholds via `normalizeAmount`; DAILY/OTHER bases yield `PERSONALIZATION_REQUIRED` rather than guessing.

## Unit Handling

- Storage: grams + per-100g normalized. `IngredientServing.grams` + `estimated` flag. `BarcodeProduct` models `servingSizeMl` + `servingUnit('g'|'ml'|'unknown')` — volume-aware.
- Conversions: `normalizeAmount` (mass-only, Decimal, range-checked, µg aliases). USDA source mapping uses nutrient **numbers** not names (`sources.js`) — no IU/DFE/available-carb substitution.
- Known soft spot: **mL≈g** in `derivedServings` label fallback and mobile `labelPortion` (correct for water-density liquids; wrong for oil/honey/syrup). Mobile mitigates with a "basis may be per 100 mL" estimate warning on such items.
- `FoodLog` macros are non-nullable except `fiberG` (NULL = unmeasured, correctly preserved by voice path `?? null`); `nutritionSnapshot.nutrientUnknowns` records what's unverified.

## Existing Audits & Docs

- `docs/health-outcomes-audit/04-NUTRITION-DATABASE-AUDIT.md` (2026-11-22) — findings F-N1…F-N10; re-verified below.
- `docs/food-logging/FOOD_LOGGING_DATABASE_QUALITY_REPORT.md` + `FOOD_LOGGING_SERVING_COVERAGE.md` (2026-11-22) — serving coverage gates; expansion run raised coverage 7.9%→83.3% and documented the 38-item unresolved queue.
- `docs/nutrition-intelligence/NUTRITION_DATA_QUALITY.md` — added-sugar/sat-fat/sodium not stored on FoodLog (always `unverified`); voice path caveat (VOICE-002).
- `docs/fiber-intelligence/FIBER_DATA_AUDIT.md` — fiber-specific (pc-HUM-3 scope).
- `docs/recipe-intelligence/database-quality-report.md` — recipe-side quality.

## Findings

### NUTR-001 — Micronutrient coverage 4.2% of ingredients
- Area: catalog · Severity: medium-high · Type: data-only
- Summary: only 18 `IngredientNutritionProfile` rows → sodium/potassium/phosphorus/sat-fat/added-sugar unknown for ~96% of the catalog. Any per-nutrient rule (HTN sodium, CKD K/P) cannot evaluate 408/426 items even once approved. Re-verified today: still 18.
- Evidence: `ingredientNutritionProfile.count()=18`; `NUTRITION_DATA_QUALITY.md`; prior audit F-N1.
- Suggested next step: data-quality validation + staged nutrient-profile import (source-backed, `verifiedAt`-gated) — prerequisite for any nutrient-level rules.

### NUTR-002 — All condition/nutrient rules 100% DRAFT → filtering inert
- Area: safety · Severity: medium · Type: requires-clinical-review
- Summary: 34/34 `ConditionRule`, 14/14 `HealthConditionNutrientRule`, 47/47 supplement interaction rules are unapproved. Correct conservative posture — but condition-aware features are effectively absent.
- Evidence: `conditionRule.count({reviewStatus:'DRAFT'})=34/34`; consumer filters on `APPROVED`/`activeAt`.
- Suggested next step: no engineering change; clinical review queue (`clinicalRuleGovernance.js`) owns activation. Do not approve without reviewer sign-off.

### NUTR-003 — IngredientAttribute misclassifications + sparse attribute model
- Area: safety/catalog · Severity: medium-high · Type: requires-clinical-review (corrections) + data-only (coverage)
- Summary: `Salmon HIGH_MERCURY` (wrong direction vs FDA "Best Choice"), `Oats CONTAINS_GLUTEN` (certification-dependent, model can't express), blanket GI labels on banana/sweet potato. Zero HIGH_SODIUM/HIGH_POTASSIUM/HIGH_PHOSPHORUS/PURINE attributes exist though rules reference them → those rules can never fire even when approved.
- Evidence: `ingredientAttribute.count()=22`; prior audit F-N4.
- Suggested next step: attribute taxonomy needs context fields (preparation/portion/certification) — clinical review before any rule depends on them; safe data-only fix = add the missing attribute vocabulary rows, not assignments.

### NUTR-004 — Test-fixture pollution in shared reference tables
- Area: catalog · Severity: medium · Type: data-only
- Summary: 10 `Ingredient` rows `source='test-fixture'` (9× "BREAD" created in a ~70 ms burst on 2026-10-30, plus `humai-test-rice-ing`); 9/21 `RuleEvidence` rows are `Test Fixture` org with `ms<base36>-EV` codes from `tests/mealSuggest.test.js` runs on 2026-11-21.
- Root cause (evidence rows): unproven. `tests/mealSuggest.test.js` creates `${S}-EV` rows where `S=ms<base36>` is a per-run prefix and its `afterAll` cleans them up — but the original teardown ran deletes sequentially, so a single throw would abort all later steps (`ruleEvidence` cleanup ran last). That is a plausible leak mechanism consistent with the residue, not a demonstrated one. All 9 residue rows are orphaned (0 referencing `ConditionRule`s).
- Root cause (ingredients): `source='test-fixture'` is an explicit fixture marker, but no committed code writes it — the BREAD/rice rows predate the `ms*` run-prefix convention; creator is unidentifiable from committed history.
- Evidence: read-only dev-DB query — fixture ingredients have live references (9 `UserIngredient` links, 1 `RecipeIngredient`, 1 `FoodLog`); evidence rows have none. `scripts/audit-junk-data.js` had `ms*`-name coverage but none for these classes.
- **What is prevented (done, worktree `humai/dev-03-pc-HUM-4-nutr004-fixtures`)**: `tests/mealSuggest.test.js` `afterAll` rewritten — every delete is an independent, failure-tolerant step; dependents delete before parents; `ruleEvidence` runs early; failures are logged not swallowed. `tests/mealSuggestResidue.test.js` asserts zero `ms*`/fixture rows — two consecutive runs on the disposable `fitness_test` DB leave no residue and preserve unrelated catalog records.
- **What can be repaired**: `audit-junk-data.js` auto-deletes a `RuleEvidence` row only when ALL ownership signals verify — `organization='Test Fixture'` AND code matches `/^ms[a-z0-9]{5,}-EV$/i` (the test's run-scoped code format) AND `evidenceNotes` contains 'Test fixture' — AND no `ConditionRule` references it. Deletion is id-scoped. Verified on `fitness_test` by `tests/auditJunkData.test.js` (order-independent; seeds lookalikes failing each signal, a referenced owned row, an ambiguous-source ingredient, and a referenced control; asserts only the owned orphan is removed).
- **What remains report-only**: `source='test-fixture'` ingredients — always report-only now, even unreferenced (the marker's origin is unknown; absence of references is not ownership evidence). 'Test Fixture' evidence missing any ownership signal, and any referenced evidence row — surfaced under `reportOnly.testFixtureEvidence{Unverified,Referenced}` and `testFixtureIngredients` for a data owner to adjudicate per-row.
- **Outstanding shared-DB cleanup**: no shared-DB writes were made. The 9 dev-DB evidence rows carry all three ownership signals and are unreferenced → eligible for a future approved `audit-junk-data.js --apply`. The 10 fixture ingredients remain report-only — 9 have live user references and all have unverifiable creators; repoint-vs-archive is a data-owner decision.
- Suggested next step: (a) approve `audit-junk-data.js --apply` on shared DB for the verified evidence orphans; (b) data-owner review of the 10 fixture ingredients; (c) audit other DB-writing suites for non-resilient teardowns.

### NUTR-005 — `verificationLevel` flag doesn't reflect actual verification
- Area: catalog · Severity: low-medium · Type: data-only
- Summary: all 228 catalog rows say `GENERIC_COMPOSITION` even where USDA-sourced serving/macro provenance exists — clients can't distinguish verified from draft by the flag.
- Evidence: `FOOD_LOGGING_DATABASE_QUALITY_REPORT.md` (verification level distribution).
- Suggested next step: promote `verificationLevel` during review passes; DTO `nutritionStatus` is the working signal until then.

### NUTR-006 — `Recipe.fiberG @default(0)` vs NULL-means-unmeasured convention
- Area: units/data · Severity: medium · Type: data-only — **likely belongs under pc-HUM-3 (fiber)**
- Summary: `Recipe.fiberG` defaults to 0 while `RecipeIngredient.fiberG` documents "NULL = not measured, never read as 0". `Supplement.{calories,proteinG,carbsG,fatG,fiberG}` are all `@default(0)` non-nullable → 0 is indistinguishable from unmeasured on supplements. `Ingredient.fiberPer100g` is correctly nullable (21 NULLs preserved).
- Evidence: `prisma/schema.prisma` lines 403/545/635; voice route writes `sup.fiberG || 0` (harmless today since column non-nullable, masks intent).
- Suggested next step: pc-HUM-3 should decide null-vs-zero semantics for Recipe/Supplement fiber; schema change needs data-quality validation.

### NUTR-007 — Duplicate normalized-name groups
- Area: catalog · Severity: low-medium · Type: data-only
- Summary: ~14 duplicate groups (glucose tablets ×5, pad thai, chicken curry ×3, quinoa cooked ×2…) — real USDA dupes with distinct ids; `Ingredient.normalizedName` is not unique (identityKey exists on catalog).
- Evidence: prior audit F-N10 + DB quality report duplicate list.
- Suggested next step: dedupe needs human verification (different USDA records ≠ same food); record, don't auto-merge.

### NUTR-008 — Serving coverage 83.3%; 38-item unresolved queue documented
- Area: units/catalog · Severity: medium · Type: data-only
- Summary: expansion run raised coverage 7.9%→83.3%; 38 foods need human/alternate-source verification (Indian foods, density-ambiguous liquids, branded-only records). 17.7% of catalog still weight-only → reproduces the original UX gap for unimported foods.
- Evidence: `FOOD_LOGGING_SERVING_COVERAGE.md` unresolved table; `ingredientServing` distinct-ingredient count 190/228.
- Suggested next step: work the documented queue (human verification); do not invent household labels — the import's weight-unit rejection is correct and should stay.

### NUTR-009 — mL treated as grams (1 mL = 1 g) in serving fallbacks
- Area: units · Severity: medium · Type: code-logic — **likely belongs under pc-HUM-5 (food units)**
- Summary: `derivedServings` accepts `servingSizeUnit='ml'` with `grams=servingSize`; mobile `labelPortion` treats `ml` identically to `g`. Correct for water-density liquids; ~40% under-count for honey, ~9% under-count for oil. Mobile shows an mL-basis estimate warning, which is honest but easy to miss.
- Evidence: `src/services/ingredientService.js:33`; `src/services/labelPortion.ts` (`unit: 'g'|'ml'` same ratio); `FoodEntryScreen.tsx:305` warning copy.
- Suggested next step: pc-HUM-5 owns the density decision (explicit `densityGPerMl` per ingredient, or restrict mL path to water-density classes). Flag liquids like oil/honey/syrup rather than assuming 1:1.

### NUTR-010 — No IU anywhere (by design) — UX gap for vitamin D etc.
- Area: units · Severity: low · Type: data-only/product-decision
- Summary: `normalizeAmount` rejects IU; nutrient master uses mcg RAE/mg alpha-tocopherol/mcg folate — scientifically correct (IU is nutrient-specific). But product labels and users think in IU for D/E/A; supplements `DOSE_UNITS` accepts IU but stores it unconverted.
- Evidence: `nutrientImport.js:10` unsupported-conversion throw; `nutrientMaster.js` comment; `schedules.js DOSE_UNITS`.
- Suggested next step: keep storage in mcg; if display in IU is wanted it needs a product decision + nutrient-specific conversion table (clinical review for factors). Also verify the nutrient importer drops vs crashes on USDA IU records — check `sources.js` behavior on e.g. vitamin D branded records (currently only 18 profiles, small blast radius).

### NUTR-011 — Mobile: weight-oz only; no mL entry for liquids
- Area: mobile-display/units · Severity: low · Type: code-logic — **pc-HUM-5 territory**
- Summary: FoodEntry offers servings + grams + weight ounces (28.3495 g). No fluid-ounce or mL path — liquids are gram-only; fl-oz USDA servings were (correctly) filtered at import (espresso). US users habitually measure liquids in cups/fl-oz.
- Evidence: `FoodEntryScreen.tsx` `OZ_G`/WEIGHT_UNITS; serving coverage doc (espresso fl-oz filtered).
- Suggested next step: pc-HUM-5 design decision — add volume units only with per-food density, or keep weight-only and document.

### NUTR-012 — HealthCondition table mixes allergies + pregnancy with diseases
- Area: safety · Severity: medium · Type: code-logic + requires-clinical-review
- Summary: 5 food allergies + Pregnancy live inside `HealthCondition` alongside diseases; allergen logic exists in two paths (condition rules vs `UserAllergy`) with weaker text matching in the condition path → double-classification and divergent behavior.
- Evidence: prior audit F-N8; `UserAllergy` is the working path (76 rows vs 1 `UserHealthCondition`).
- Suggested next step: consolidate allergy evaluation on the `UserAllergy` path; decision on pregnancy-as-condition needs clinical input.

### NUTR-013 — Meal-level heuristic warning multipliers are engineering heuristics
- Area: safety · Severity: low-medium · Type: code-logic (flag before treating as clinical)
- Summary: `nutritionValidator` warns at hardcoded 1.3× calorie / 0.5× protein / 1.5× carb+fat of per-meal targets — reasonable UX heuristics but not evidence-based thresholds; shouldn't be presented as clinical boundaries.
- Evidence: `src/services/safety/nutritionValidator.js` (calories_excess/protein_low/carbs_excess/fat_excess).
- Suggested next step: label as informational nudges in UX copy (verify current copy); if they ever drive blocking, route through clinical review.

### NUTR-014 — `calorieSafety` floor module is inactive (correctly)
- Area: safety · Severity: info · Type: requires-clinical-review (activation only)
- Summary: per-user `0.8×BMR` floor with supervision gates (under-18, pregnancy, lactation, ED risk, CKD/T1D/cancer/bariatric/HF → `clinician_review_required`) — well-governed but **not wired to any route**; `scoringV2` understands `calorieFloor` but nothing feeds it.
- Evidence: `src/services/calorieSafety.js` header comment; `docs/nutrition-intelligence/CALORIE_SAFETY_POLICY_PROPOSAL.md`.
- Suggested next step: none in pc-HUM-4; activation is a clinical+product decision.

### NUTR-015 — Barcode catalog essentially empty (4 products)
- Area: catalog · Severity: medium · Type: data-only
- Summary: `BarcodeProduct` went 0→4 rows since 11-22; every other barcode scan resolves to nothing. Schema supports `servingSizeMl`/`servingUnit` properly — it's a pure data gap.
- Evidence: `barcodeProduct.count()=4`; serving coverage report lists this as a FAIL gate.
- Suggested next step: product decision on barcode provider/import before feature is exposed broadly.

### NUTR-016 — Legacy FoodLogs lack provenance snapshots (80%)
- Area: catalog · Severity: low · Type: data-only
- Summary: 260/323 logs have `nutritionSnapshot=NULL` (pre-snapshot era + partial voice writes) — they render as weight entries (correct backward compat) but analytics/provenance queries must exclude them.
- Evidence: `foodLog.count({nutritionSnapshot:DbNull})=260`.
- Suggested next step: none — honest historical records; keep the legacy-weight rendering; document for future analytics.

### NUTR-017 — Prior F-N3 (stale SYSTEM recipe nutrition) appears RESOLVED on current data
- Area: catalog · Severity: info · Type: data-only
- Summary: prior audit found 15/28 SYSTEM recipes >20% off vs recomputed. Re-check today: 0/244 checkable recipes diverge >20% (line snapshots appear refreshed; all 258 recipes now `isSystem=true`, so the SYSTEM/imported flag no longer discriminates). 17 ingredient lines still have `ingredientId=NULL` (unverifiable).
- Evidence: re-verification query comparing `sum(amountG×caloriesPer100g/100)/servings` vs `Recipe.calories`.
- Suggested next step: close F-N3 in the next full audit; track the 17 unresolved lines for manual mapping; investigate why `isSystem` is true for all recipes (flag semantics drifted — low-priority data question).

### NUTR-018 — Mock-ordering flake in `supplementIntel.test.js` under multi-file runs
- Area: other (test reliability) · Severity: low · Type: code-logic
- Summary: `GET /supplements/safety` test failed once in a 44-suite pattern run (`disclaimers` undefined → likely a 401/500 body) but passes standalone and on re-run — order-dependent mock/env state between test files.
- Evidence: `npx jest --testPathPattern=...` first run 1/533 fail; isolated + second full run green.
- Suggested next step: make the test independent of cross-file state (explicit env/flag setup inside the suite), or investigate which suite mutates shared env. Not a domain issue.

## Test Coverage Notes
- Nutrition-related suites: 44 test files matched `(nutrition|food|recipe|supplement|health|nutrient|ingredient|meal|macro|fiber)` → **533 tests, all pass** (one flaky failure seen once — NUTR-018).
- Coverage exists for: USDA import validation, condition-rule import gating, serving import sanity filters, nutrient normalization (Decimal/precision), food logging integrity, supplement scheduling/doses.
- Coverage gaps: no test asserts mL≈g behavior or density handling (NUTR-009/011); no test for `derivedServings` label fallback with mL basis; recipe-stored-vs-recomputed reconciliation is a manual audit query, not a test (NUTR-017).

## Open Questions for Next Iteration
1. Confirm `sources.js`/`nutrientImport` behavior when USDA records carry IU for D/E/A (drop, throw, or silently store?) — small blast radius at 18 profiles.
2. Why `isSystem=true` on all 258 recipes (flag semantics vs SYSTEM reviewStatus).
3. Whether `Recipe.calories`/`portionG`/`finishedYieldG` stay consistent after future recipe edits (no DB trigger; computed at write time).
4. Mobile `labelPortion` 'package' unit: `packageServings` free-text has no server-side validation.

## Iteration 2 — Open-question resolutions + new finding (2026-11-25)

**OQ-1 — Importer behavior on IU-unit USDA records (answered):** `sources.fromUsda` calls `normalizeAmount(amount, unitName, master.unit)` inside the nutrient loop; `normalizeAmount` accepts only g/mg/mcg and kcal↔kJ, so a USDA record carrying `unitName:'IU'` (real vitamin-D records do) **throws `Unsupported unit conversion: IU -> mcg` — the entire import record is rejected**, not the single nutrient. Verified with a synthetic envelope: a record with parseable kcal + one IU nutrient throws identically to an IU-only record. Fail-loud, no silent store; blast radius confirmed small (18 profiles). The "drop vs crash" question is resolved: **crash (record-reject)** — which also means any USDA record whose *any* mapped nutrient arrives in IU is wholly unimportable until conversion handling lands (ties to NUTR-010's product decision).

**OQ-2 — Why `isSystem=true` on all 258 recipes (answered + escalated to finding):** `recipeImport.js` hardcodes `isSystem:true` on every import; cross-tab: `isSystem:true`×{RESEARCH_DRAFT 230, SYSTEM 28}. The column now means "catalog (non-user) recipe", not "curated". Enforcement consequence is real — see NUTR-019.

### NUTR-019 — `reviewStatus` not enforced on recipe read/suggest paths
- Area: catalog/safety gating · Severity: medium · Type: code-logic
- Summary: visibility gates `OR:[{isSystem:true},{creatorId:userId}]` in `GET /recipes/:id/intelligence` (recipes.js:7), `recipeService.searchRecipes` (~97) + `getRecipeNutrition` (~109), `mealSuggestion.candidates` (~117), and `nutritionRecommendation` (~33) carry **no `reviewStatus` predicate**. Only mutation routes (recipes.js:195,245) exclude `REJECTED`. Net effect: all 230 `RESEARCH_DRAFT` (unverified import) recipes are served in search, nutrition, intelligence and meal-suggestion surfaces as if system-curated; any recipe set `REJECTED` remains fetchable by id, searchable, and suggestible.
- Evidence: code refs above; `SELECT isSystem,reviewStatus,count(*) → {t,RESEARCH_DRAFT:230},{t,SYSTEM:28}`; `REJECTED` rows currently **0** (exposure is live for the 230 drafts; the REJECTED leak is latent).
- Suggested next step: decide intended read-gate (`reviewStatus IN ('SYSTEM','VERIFIED')` on all catalog reads, or per-surface draft labeling); add a regression test asserting REJECTED/DRAFT visibility rules per endpoint.

## Remaining open questions (unchanged)
3. `Recipe.calories`/`portionG`/`finishedYieldG` consistency after edits (computed at write, no trigger) — unverified drift risk.
4. Mobile `labelPortion` 'package' free-text — no server validation.
