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
