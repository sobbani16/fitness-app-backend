# Recipe Intelligence — IMPLEMENTATION_PROGRESS

**Program:** AI recipe generation + validation (master prompt, 20 phases)
**Last update:** 2026-11-21 (session 2, continued)
**Current phase:** Phase 1 ✅ engine · Phase 5 ✅ validator core · Phase 4+8 ✅ generation+fallback — next: ranking (9), caching/versioning (12), observability (17), scenario registry (14), mobile UX (11)

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
| Code changes | `recipes/constraints.js`, `recipes/validate.js` (+`recordValidation`), `recipes/generate.js`, `recipes/metrics.js` (new); `recipeMatch.js`, `routes/recipes.js`, `routes/admin.js` (2 analytics endpoints), `foodIntel.js` (shared LABEL_ANIMAL_TERMS), `featureRegistry.js` (`ai_recipe_generation_enabled`) |
| Tests added | recipeConstraints 23 + recipeValidate 14 + recipeGenerate 9 = 46 new; all green; adjacent suites unaffected |
| Deliverable docs | **13/13 complete**: audit, progress, constraint-taxonomy, recipe-validation-spec, scenario-registry.json, database-quality-report (+raw JSON +script), architecture, medical-rule-evidence, ingredient-data-audit, test-results, security-review, performance-report, release-readiness |
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
3. ~~`constraint-taxonomy.md`~~ **DONE** + `foodIntel` now imports shared `LABEL_ANIMAL_TERMS` (full keyword-table retirement deferred — `checkSuitability` API consumers need parity tests first).
4. ~~`validateGeneratedRecipe` staged pipeline~~ **DONE** — `recipes/validate.js` v1: schema → identity → quantity → decompose → allergen/exclusion/pattern/medical → nutrition → feasibility → safety → servings → substitution; typed PASS/FAIL/NEEDS_CLARIFICATION/NEEDS_REVIEW; `/customize` now revalidates post-transformation (F-5 partially closed — persisted validation + instruction↔line consistency still open).
5. ~~`generate.js` via `askJSON` + flag + route~~ **DONE** — `POST /recipes/generate` behind `ai_recipe_generation_enabled`; one bounded correction attempt (failed ruleIds fed back); VERIFIED-recipe fallback via matchIngredients; `no_eligible_recipe` outcome.
6. ~~scenario registry + observability~~ **DONE** — `scenario-registry.json` (59 scenarios, implemented↔pending); `recipes/metrics.js` counters wired into generate/validate/customize; `recordValidation` persists `SafetyAuditLog` (checkType `recipe_validation`, ruleIds only); admin endpoints `/admin/recipe-intelligence/metrics` + `/validation-log` behind `VIEW_PLATFORM_ANALYTICS`.
7. ~~save-generated persistence + limits + equipment stages + E2E~~ **DONE** (commit 6c537a1); ~~Phase 15 DB-quality report~~ **DONE** (real findings: 150 missing instructions, 62 meat-no-temp, 138 undeclared allergen lines, 55 unlinked lines, 44 catalog allergen-hint gaps, 1 genuine macro defect, all 48 clinical rules DRAFT).
8. ~~remaining deliverable docs~~ **DONE — all 13 written**; verdict in `release-readiness.md`: NOT production-ready — blocking gates 7 (no approved clinical rules), 10 (data-quality fixes), 13 (mobile surface).
9. ~~Phase 11 mobile surface~~ **DONE** (mobile commit a4c2dbf: generateRecipes/saveGeneratedRecipe API + Generate button, validation-status chips, save→revalidate flow in RecipeByIngredients; graceful 404 when flag off); ~~ISO-001~~ **DONE** (cross-user isolation test — 80 green).
10. ~~full `npm test` regression~~ **DONE** (1444 green; sk-prefix DB-interference found+fixed); ~~Objective-1 data remediation~~ **DONE** (scripts/remediate-recipe-data.js, verified-tier applied: 38 relinks, 42 catalog declarations, 183/258 recipes now declared, 31 temp steps, GLUCOSE capped; residuals: 150 missing instructions + 16 composite lines + 9 recipe flags — all needs-human or documented FPs).
11. ~~Objective-2 clinical-rule approval workflow~~ **DONE** — `GET /admin/clinical-rules` (queue+gaps), `POST /admin/clinical-rules/transition` (ACADEMY_CLINICAL_REVIEW gate, ≥20-char attestation, gap-blocked approval, SafetyAuditLog). Findings: 31/34 legacy rules have NO evidence; all 14 nutrient rules have null thresholds; **0 approvable today** — by design. 8 tests green.
12. ~~Phase 9 ranking~~ **DONE** (rankScore on survivors only, exclusion-invariance tests); ~~safe caching~~ **DONE** (version-stamped catalog cache, CACHE-001/STALE-002 tests); ~~PERF-001~~ **DONE** (scripts/recipe-perf.js — constraints p95 2.2ms, validate p50 0ms, match p95 228ms, AI 1.3–2.3s, ~599 tok/call ~$0.0006, validation <0.01% overhead).
13. ~~Objective-6 synthetic-user verification~~ **DONE** — `scripts/recipe-synthetic-verify.js` (in-process app + real DB + real AI; flag toggled via `FF_*` env in-process only). **22/22 checks pass**: flag OFF→403 before/after (rollback), per-user constraint loading (13 peanut terms A vs 0 B), dislike=soft vs NEVER=hard, allergy exclusion (28 recipes excluded), real AI generation→NEEDS_REVIEW candidate, save→RESEARCH_DRAFT, posted-PASS tamper→422, customize→revalidation, nutrition recomputed (125.7 kcal/100g), meal logging 201, owner-scoped isolation. **Two real defects found+fixed:** (a) `generate.js` resolved pantry items via exact `byName` — 'rice' missed 'Rice, basmati, cooked', model saw empty pantry and declined → now uses `resolveInputs` variant matching; (b) `save-generated` never persisted `portionG`/`finishedYieldG` → `/nutrition` unusable for saved generated recipes → now persists validator `totalG`/servings.
14. NEXT: full suite + docs final pass (objective 7).

## Blockers / open decisions (need owner)

- D2 (recommender/scorer consolidation) — carried from nutrition-intelligence; recipe work should avoid adding a fourth ranker.
- Clinical rules remain DRAFT → medical stages evaluate but cannot hard-block via nutrient rules until clinician approval; allergen/exclusion paths work regardless.
- `@test.dev` users (1,817) and dup groups — report-only pending deletion policy.

## Log

- 2026-11-21 s1: repo+DB discovery complete; audit + progress docs written; no code/DB changes.
- 2026-11-21 s2: `constraints.js` constraint engine (word-boundary + plural-tolerant matching — `egg`≠`eggplant`, `nut`≠`walnut`); `matchIngredients` + `/customize` consume server-side constraints (F-1 closed); added `/customize` hard-check on proposed adds/swaps incl. condition-rule attributes; `excluded` counters extended (`exclusion`,`condition`); 23 new tests green; neighboring suites green (57 tests).
- 2026-11-21 s2b: `recipes/validate.js` staged validator (fail-closed identity for allergic users; compound/decompose review; deterministic nutrition; poultry/raw-egg/raw-flour/rice safety rules); `/customize` revalidates transformed recipes; `recipes/generate.js` + `POST /recipes/generate` behind new `ai_recipe_generation_enabled` flag; `foodIntel` uses shared `LABEL_ANIMAL_TERMS`; +22 tests (45 total recipe-intelligence).
- 2026-11-21 s2c: `recipes/metrics.js` (generate/validate/customize counters incl. provider errors, retries, fallback hits); `recordValidation` → `SafetyAuditLog` on every generate-candidate + customize transformation; admin analytics endpoints; `recipe-validation-spec.md` + `scenario-registry.json` deliverables; +1 test (46).
- 2026-11-21 s2d: `POST /recipes/save-generated` (server-side revalidation, RESEARCH_DRAFT, ai: sourceKey, name disambiguation F-9); limits stage (APPROVED nutrient rules vs computed values — exceed=block, missing=review); equipment stage (clarify when known set); E2E test; `scripts/recipe-data-quality.js` read-only audit + `database-quality-report.md` + raw JSON; +5 tests (79 green).
- 2026-11-21 s2e: remaining 7 deliverable docs written (architecture, medical-rule-evidence, ingredient-data-audit, test-results [79/79 verified live], security-review, performance-report, release-readiness [gate checklist — verdict: not production-ready, gates 7/10/13 blocking]).
- 2026-11-21 s3: synthetic verification 22/22 green vs real AI+DB; fixed `generate.js` empty-pantry resolution bug (exact→variant match via exported `resolveInputs`) and `save-generated` missing `portionG`/`finishedYieldG` persistence (validator now returns `totalG`); model `notes` surfaced in meta for diagnosability.
