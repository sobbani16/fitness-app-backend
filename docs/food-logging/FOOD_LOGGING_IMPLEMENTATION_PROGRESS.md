# Food Logging — Implementation Progress

Branch backend `feat/activity-safety-engine` @ `3efeaab` → food-logging commits on top. Mobile `main` @ `a4c2dbf`.
Resume rule: read this file + TEST_MATRIX first; do not redo VERIFIED tasks.

## Task ledger

| Task | Pri | Status | Root cause | Files | Changes | Commit |
|---|---|---|---|---|---|---|
| P0 baseline docs | P0 | VERIFIED | — | this file | created docs/food-logging/* | — |
| FL-001 missing slice unit | P0 | IN_PROGRESS | `IngredientServing` table has **0 rows**; curated catalog `sourceRecord` (GENERIC_RESEARCH_DRAFT) carries no household measure; USDA `foodPortions` never imported. Prior fix f137189 fixed client UI only — no data ever populated. | schema `IngredientServing`, `ingredientService.derivedServings`, `FoodEntryScreen.servingUnits` | plan: import USDA foodPortions → IngredientServing rows w/ sourceRecord attribution | — |
| FL-002 duplicate nutrition labels | P0 | IN_PROGRESS | literal dup text `{cal} kcal / 100g · per 100g: P…` | `FoodEntryScreen.tsx:568` | rewrite label per spec | — |
| FL-003 generic 100 g default | P0 | VERIFIED-not-a-defect | `first?.grams ?? 100` fires ONLY when servings absent; never labels 100 g as a household serving and never overrides verified servings (first serving wins). `servingUnitId` left unset → unit stays Grams. Semantics compliant; documented. | `FoodEntryScreen.tsx:271,294` | none | — |
| Map entry points (Phase 2) | P1 | IN_PROGRESS | — | FoodEntryScreen, ingredients.js, foodLogs.js, usdaService, ingredientNutrition | below | — |
| DB audit (Phase 3) | P1 | NOT_STARTED | — | — | — | — |
| Canonical serving model (Phase 4) | P0 | IN_PROGRESS | model exists (IngredientServing label/grams/estimated/sourceRecord); needs verified data + stable unit ids | — | — | — |
| Nutrition engine (Phase 5) | P1 | IN_PROGRESS | `ingredientNutrition.scale` per-100g + servingId already deterministic; mobile `applyPortion` keeps grams canonical | verify drift/missing-nutrient handling | — | — |
| UX repair (Phase 7) | P0 | IN_PROGRESS | mostly built (unit sheet, review gate, estimated flags) | FoodEntryScreen | FL-002 text; portion-prominent display check | — |
| Round-trip persistence (Phase 10) | P1 | IN_PROGRESS | snapshot stores `selectedServing` label + catalogRevision; servingId not sent | foodLogs.js, FoodEntryScreen | add servingId to payload+snapshot | — |

## Phase 1 reproduction evidence

- `IngredientServing.count()` → **0**. `bread_wholewheat` catalog row: `sourceRecord.status=GENERIC_COMPOSITION`, `source=GENERIC_RESEARCH_DRAFT_NOT_VERIFIED`, kcal 247 P13 C41 F4.2 per 100 g — matches the reported `247 kcal / 100g` UI string exactly.
- Search `/ingredients/search?q=whole wheat bread` → catalog tier returns `toDto` with `servings: []` → mobile `servingUnits()` yields only Grams/Ounces.
- USDA-sourced ingredients DO get `label-serving` (householdServingFullText) — the derivation path works; curated catalog items lack the data.

## Log

- 2026-11-21 s4: baseline + Phase-1 reproduction. All 3 defects root-caused. FL-003 documented as compliant fallback. USDA_API_KEY present → verified `foodPortions` import path is viable.
- 2026-11-21 s5: **FL-001 RESOLVED-VERIFIED** — `usdaService.getUsdaFood` + `import-ingredient-servings.js` imported **61 USDA-verified servings for 18 priority foods** (bread `1 slice`=32g SR172688, egg `1 large`=50g, roti `1 piece`=43g, apple sm/med/lg, chicken `1 piece`=272g raw, yogurt container, milk cup, almond `1 almond`=1.2g, PB `2 tbsp`=32g, pita, oats cup=80g). `foodLogs` accepts `servingId`+`servingCount` → backend-authoritative conversion; snapshot stores servingId/servingGrams; invalid servingId → 400. `food-logging-verify.js` E2E: **14/14 PASS**. **FL-002 FIXED** (mobile `Per 100 g: 247 kcal · Protein 13 g · …`). Mobile typecheck+13 tests green; backend recipe/foodIntel suites green.
- COMMITS (verified 2026-11-21 s6 — all changes present at HEAD, nothing overwritten/omitted):
  - `e3dac1f` (owner): `usdaService.getUsdaFood`, `import-ingredient-servings.js`, `FOOD_LOGGING_TEST_MATRIX.md`, part of `foodLogs.js` (snapshot servingId/servingGrams)
  - `4f504a9` (owner): `foodLogs.js` servingId+servingCount authoritative conversion block
  - `bca3b67` (mine): `food-logging-verify.js` (14/14 E2E)
  - `ab36282` (mine): progress log
  - mobile `c3c7a49` (mine): FL-002 label + mealSync servingId/servingCount + LoggedMeal fields
- DB state: **61 IngredientServing rows** (verified). Owner's uncommitted work in tree: `environmentService.js` + test — DO NOT TOUCH.
- RESUME POINT: Phase 2 entry-point map → Phase 3 DB audit → Phase 8 portion memory → Phase 9 voice/barcode/photo → Phase 11 security → Phase 14 coverage → Phase 15 deliverables. NOT DONE items unchanged. Device-side verification still BLOCKED (no running app).

## 2026-11-22 s7 — DEVICE VERIFICATION COMPLETE (iPhone 17 Pro sim, Maestro 2.12.1)

**Environment:** backend `feat/activity-safety-engine`, mobile `main`, local Postgres, `node src/index.js` :4000, Expo dev client `com.sobbani.fitnessappmobile`, Metro :8081. Synthetic account `fl-device-verify@syn.local` (emailVerifiedAt + profile set server-side; owner session signed out via UI — owner's data untouched).

**New defects found & fixed during device verification:**
1. **Weight-unit pseudo-serving outranked slice** — USDA import pulled `1 oz`(28.35g) / `4 oz`(113g) portions whose label is a weight unit; `servings[0]` became "1 oz" so the device defaulted to ounces. Fix: `derivedServings` sorts weight-unit labels last (`ingredientService.js`); import script drops pure weight-unit labels; 3 bad rows deleted. API now returns `1 slice` first.
2. **Reopen lost the serving unit** — `mode:'repeat'` rebuilt preview from `quantityG` only → "2 slices" reopened as "64 g". Fixed in `FoodEntryScreen` (restores servingId/selectedServing/qty from snapshot `servingGrams`, else `quantityG/count`) + `mealSync` reconcile maps server `servingId/servingCount/selectedServing` onto local meals + snapshot now stores `servingCount` server-side.

**Device-verified chain (Maestro `food-logging-verify.yaml`, all steps PASS):**
search "whole wheat bread" → result `Whole wheat bread, ready (ready)` → **`Serving size: 1 slice` default** → sheet shows `1 slice, 32 grams` + `Grams` + `Ounces` → label `Per 100 g: 247 kcal · Protein 13 g · Carbs 41 g · Fat 4.2 g` (FL-002) → qty `2` → `= 64 g total` → kcal 158, P 8.3 / C 26.2 / F 2.7 / fiber 4.5 → `Saved on this device` → **Postgres FoodLog**: qty 64, kcal 158, P8.3/C26.2/F2.7/fiber4.5, `servingId: srv_bread_wholewheat_1`, `servingGrams: 32`, `selectedServing: "1 slice"` → saved-list row `Whole wheat bread, ready` → **reopen restores `1 slice (32 g)` + `2` servings**.

Evidence: `~/.maestro/tests/2026-11-22_000628/food-logging-verify/takeScreenshot/{03..11}.png`; exit code 0.

**Commits:** backend `e799525`, mobile `22994ad` (both contain ONLY food-logging hunks — owner's concurrent uncommitted work untouched).

**Status updates:** FL-001 → VERIFIED (device). FL-002 → VERIFIED (device). Phase 10 round-trip → VERIFIED for unit/qty/nutrition (edit-in-place still untested). Device verification blocker CLEARED.

**Tooling note:** Maestro iOS matches element text EXACTLY; RN tab items expose `Foo, tab, N of 5`; debugger banner overlays bottom button — point-tap ✕ (92%,93%).

RESUME POINT unchanged minus cleared blocker: Phase 2 map → Phase 3 DB audit → Phase 8 portion memory → Phase 9 voice/barcode/photo → Phase 11 security → Phase 14 coverage → Phase 15 deliverables.

## 2026-11-22 s8 — Phases 2,3,6,8,10,11 executed

**Phase 2 — entry-point map:** 19 flows mapped in `FOOD_LOGGING_MASTER_AUDIT.md` (search, repeat, copy, quick-add, recipes, barcode, label-scan, photo, voice, manual/custom, saved templates, offline/outbox, scale, menu-scan, water). New finding: **VOICE-001** — `/voice/commands/execute` LOG_FOOD requires `item.grams`; household-unit items ("2 slices") are skipped unless the interpreter supplies grams. **VOICE-002** — voice path writes `?? 0` for missing nutrients (silently zeroes unknowns vs catalog-null semantics).

**Phase 3 — DB audit:** `FOOD_LOGGING_DATABASE_QUALITY_REPORT.md` written. Key numbers: 420 ingredients / 228 catalog (all usable) / 58 serving rows on **18 ingredients** / **210 usable catalog items (92%) have no serving** / 277 FoodLogs / 0 orphans / 0 negative-or-implausible nutrients / 21 missing fiber / **all 228 catalog rows `GENERIC_COMPOSITION`** / BarcodeProduct **0 rows** / **260/277 logs have no nutritionSnapshot** (pre-snapshot era — treated as weight entries) / 14 non-test duplicate normalized-name groups / 10 test-fixture ingredient rows excluded from search.

**Phase 6 — search validation:** `bread` → Breadcrumbs, Pita (2 servings), White (8), Whole-wheat (1); `whole wheat` → exact record #1; `egg/chicken/apple/milk/rice/oats` all return relevant items with serving counts surfaced. Injection-safe (Prisma). Ranking acceptable — alphabetical within tier, verified items present.

**Phase 8 — Smart Portion Memory:** **FEATURE ABSENT.** No portion-memory implementation on either side (`portionMemory`/`lastServing` greps empty); unit always defaults to first serving/grams. Recorded as gap, not regression.

**Phase 10 — edit-in-place:** **FEATURE ABSENT by design.** No PUT/PATCH on `/food-logs`; mobile always generates a new id (`Date.now()-random`) → POST is a pure create; repeated delivery of the same id is a no-op (409 cross-user). Edit semantics = delete+create. Round-trip VERIFIED on device s7.

**Phase 11 — security/isolation:** unauthenticated GET/POST → 401; cross-user GET → 404 (verified, `web-1793…` invisible to synthetic acct); same-id cross-user POST → 409; injection in `q`/`date` → safe/400; `quantityG` bounds (-5, 999999, "abc") → 400; `servingCount` -2/0 → coerced to default (NOT rejected — see SEC-NOTE below); `servingCount` 99999 → 400 (weight bound); invalid/cross-ingredient `servingId` → 400; foodName 5000 chars → truncated to 300.

**SEC-NOTE:** `servingCount<=0` silently coerces to 1 instead of rejecting — harmless (produces count-1 snapshot) but inconsistent with `servingId` strictness. Suggest rejecting non-finite/negative counts for symmetry.

**Test state:** backend jest — 128 suites pass incl. every food/ingredient/meal/nutrition suite (foodExpansion, meals.route, ingredients.route, ingredientCatalog, nutritionStatus, foodIntel, foodDetector, mealAnalyzer, mealSuggest, ingredientV5/Impact). 8 suite failures are TEST_DATABASE_URL isolation issues (academy, asyncScenarios, smartKitchen, trainerNutrition, photoScan, identity, exerciseLibrary) — pre-existing env, not food-logging. Mobile: `tsc --noEmit` clean, 74 suites/426 tests pass. `food-logging-verify.js` 14/14 green on final code.

**Commits:** `3b4934c` master audit + DB quality report.

**RESUME POINT:** Phase 4 canonical model review (largely documented in DB report), Phase 5 deterministic nutrition engine deep-check, Phase 7 UX labels (FL-002 verified; estimate-labeling on other flows), Phase 9 voice/barcode/photo functional audit on device, Phase 12 E2E matrix, Phase 13 real env, Phase 14 coverage report (serving-coverage doc written — **coverage gate FAILS at 7.9%**), Phase 15 final verdict.
