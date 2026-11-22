# Recipe Intelligence — IMPLEMENTATION_PROGRESS

**Program:** AI recipe generation + validation (master prompt, 20 phases)
**Last update:** 2026-11-21 (session 2)
**Current phase:** Phase 1 in progress — normalized constraint engine built + wired into match/customize; taxonomy consolidation + validation pipeline next

## Resume protocol

1. Read this file → `00-current-state-audit.md` → `../nutrition-intelligence/STATUS.md`.
2. `git status` both repos — backend carries uncommitted prior-session work (see below); do not lose it.
3. Never `prisma migrate dev`/`migrate reset` (AGENTS.md drift). New schema = `migrate diff` reviewed SQL + `--create-only` + `migrate resolve`.
4. Junk/data scripts are dry-run first (`scripts/audit-junk-data.js`).
5. New feature code sits behind flag `ai_recipe_generation` (to be added; group `'ai'`, default false) — never enabled by default.

## State at checkpoint

| Item | Status |
|---|---|
| Phase 0 audit (repo + DB) | ✅ `docs/recipe-intelligence/00-current-state-audit.md` — incl. gap matrix + live DB counts |
| Deliverable docs (13 required) | 2/13 written (audit + this file); `constraint-taxonomy.md` next |
| Schema changes | none yet |
| Code changes | `src/services/recipes/constraints.js` (new), `src/services/recipeMatch.js`, `src/routes/recipes.js` |
| Tests added | `tests/recipeConstraints.test.js` — 23/23 pass; adjacent suites green (smartKitchen, recipes.route, foodIntel — 57 total) |
| DB audit (Phase 15) | baseline counts captured in audit §7; full report pending |
| Safety/clinical review | nothing new enabled; all clinical rules remain DRAFT/inert |

## Key findings to honor

- ~~**F-1 (high):** `match-ingredients` + `/recipes/:id/customize` trust client-supplied `allergies`/`diet`~~ **CLOSED s2** — both consume `loadConstraints(userId)`; profile allergies/NEVER_RECOMMEND/approved condition rules now enforce server-side; request params narrow-only. Covered by tests (`F-1` + `customize` cases).
- **F-2:** `UserHealthCondition` = 0 rows locally; medical paths only exercised via fixtures.
- **F-3:** three divergent allergen/diet keyword sets — consolidate via taxonomy (safety refactor).
- **F-5:** `/customize` doesn't re-check instruction↔ingredient consistency or persist validation.
- **F-9:** `Recipe.recipeName @unique` globally — generated names need disambiguation.
- Catalog categories case-inconsistent (`Vegetable`/`vegetable` etc.); Allergy table has only `peanut`/`Peanuts`.
- Prior-session uncommitted work exists (nutrition-intelligence + activity-safety: modified services/tests, new docs/scripts). **Verify before building on:** `git status` — see `docs/nutrition-intelligence/STATUS.md`.

## Next actions (in order)

1. ~~`src/services/recipes/constraints.js`~~ **DONE** — `loadConstraints`/`violatesHard`/`textHasTerm`; classes: allergy/medical(APPROVED-gated)/exclusion/pattern/dislike/limits/soft/equipment/availability/unknown.
2. ~~Retrofit `recipeMatch.matchIngredients` + `/customize`~~ **DONE** — both call `loadConstraints`; `excluded` response now reports `{allergy,diet,prepTime,exclusion,condition}`.
3. `constraint-taxonomy.md` deliverable + retire `foodIntel`/`mealSuggestion` duplicate keyword tables behind the shared module (parity-or-stricter tests; keep `checkSuitability` API stable).
4. `validateGeneratedRecipe` staged pipeline + typed outcomes (schema → identity → quantity → decompose → allergy → exclusions → pattern → medical → nutrition → feasibility → safety → serving → substitution → eligibility).
5. `generate.js` via `askJSON` + feature flag + route.

## Blockers / open decisions (need owner)

- D2 (recommender/scorer consolidation) — carried from nutrition-intelligence; recipe work should avoid adding a fourth ranker.
- Clinical rules remain DRAFT → medical stages evaluate but cannot hard-block via nutrient rules until clinician approval; allergen/exclusion paths work regardless.
- `@test.dev` users (1,817) and dup groups — report-only pending deletion policy.

## Log

- 2026-11-21 s1: repo+DB discovery complete; audit + progress docs written; no code/DB changes.
- 2026-11-21 s2: `constraints.js` constraint engine (word-boundary + plural-tolerant matching — `egg`≠`eggplant`, `nut`≠`walnut`); `matchIngredients` + `/customize` consume server-side constraints (F-1 closed); added `/customize` hard-check on proposed adds/swaps incl. condition-rule attributes; `excluded` counters extended (`exclusion`,`condition`); 23 new tests green; neighboring suites green (57 tests).
