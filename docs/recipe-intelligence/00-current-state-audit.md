# Recipe Intelligence — Phase 0: Current-State Audit

**Date:** 2026-11-21 · **Scope:** `fitness-app-backend` + `fitness-app-mobile` · **Method:** full repository inspection + read-only live DB queries against local dev Postgres (`fitness_app`). No production access used; no data mutated.
**Prior art:** this feature sits on top of the nutrition-intelligence engine audited in `docs/nutrition-intelligence/` (AUDIT.md, PIPELINE.md, STATUS.md, DATA_QUALITY.md). Where those docs already cover a layer, this audit references rather than repeats them.

Legend: **EXISTS** = implemented and wired · **PARTIAL** = present but incomplete · **MISSING** = not present · **RISK** = present with a correctness/safety concern.

---

## 1. Executive summary

Humai already has most of the *substrate* this feature needs: a recipe model with structured instructions and allergen fields, a canonical ingredient catalog with aliases, a per-100g nutrition layer with null≠zero discipline, a clinical-rule governance skeleton (evidence → rule → review → APPROVED-only consumers), a strict-schema AI provider with quota + kill switch, a 60+ flag feature system, and a working ingredient→recipe matching flow on mobile.

What does **not** exist: AI recipe *generation* (only line-edit customization + re-rank), a single normalized constraint object (each service loads its own subset), a canonical ingredient taxonomy with derivative/hierarchy metadata (allergen matching is keyword-based), instruction/food-safety validation, a regeneration loop, typed validation outcomes (`PASS/FAIL/NEEDS_*`), generation provenance, and most of the recipe-intelligence test matrix.

**Two real findings worth noting up front** (details in §6):

- **F-1 (client-trusted constraints):** `POST /recipes/match-ingredients` and `POST /recipes/:id/customize` take `allergies`/`diet` from the *request body* and never consult `UserAllergy`/`UserPlanningPreferences` server-side. A client that omits them gets unfiltered results. The master prompt requires server-side health-constraint loading; today constraint loading is client-opt-in on these two endpoints.
- **F-2 (no user health conditions locally):** `UserHealthCondition` has **0 rows** in the dev DB, so condition-rule paths (already correctly gated to APPROVED) cannot fire for any local user. All condition-aware behavior is currently only exercised via unit-test fixtures.

---

## 2. What already exists (reuse candidates)

### 2.1 Data model (prisma/schema.prisma)

| Model | Role for this feature | State |
|---|---|---|
| `Recipe` (:277) | name, cuisine, region, mealType, servings, per-serving macros, `portionG`, `finishedYieldG`, `prepMinutes`, `instructions` Json `[{step,text,minutes,safetyNote,optionalIngredients}]`, `safetyNotes` Json, `allergens[]`, `reviewStatus` (`SYSTEM|RESEARCH_DRAFT|VERIFIED|REJECTED`), `sourceKey` unique, `nutritionSource` Json provenance, `aliases[]` | EXISTS — instruction shape already carries per-step safety notes. `fiberG @default(0)` is a null≠0 counter-example. |
| `RecipeIngredient` (:342) | line: `ingredientId?`, `ingredientName`, `amountG`, `optional`, per-line macro snapshot, `nutritionSnapshot` | EXISTS — 1,659/1,714 lines linked to Ingredient rows locally |
| `RecipeEngagement` (:387) | per-user favorite/rating/notes/`customData` variant (private) | EXISTS |
| `Ingredient` (:577) | per-100g macros, `fdcId` unique, `normalizedName`, `sourceMetadata` | EXISTS — 420 rows, 244 w/o fdcId |
| `IngredientCatalog` (:1767) | canonical name, `aliases[]`, `category`, `preparation`, `usable`, `verificationLevel`, `sourceRecord` (carries `allergens` on 101/228 rows) | PARTIAL — categories are case-inconsistent (see §7) |
| `IngredientNutritionProfile`/`IngredientNutrient`/`Nutrient` (:1837-83) | verified per-prep nutrient records (RAW/BOILED/…), source citation w/ SHA-256 | EXISTS — only 18 profiles populated |
| `IngredientAttribute` (:636) | free-form attribute tags (NUT, CONTAINS_GLUTEN, …) | EXISTS — sparse coverage |
| `IngredientServing` (:1792) | labeled serving→grams | EXISTS — 1 row locally |
| `Allergy`/`UserAllergy` (:118/126) | user allergies | EXISTS — Allergy catalog only 2 rows (`peanut`, `Peanuts` near-dup); UserAllergy 76 |
| `HealthCondition`/`UserHealthCondition` (:89/102) | 22 canonical conditions incl. Pregnancy, Prediabetes, PCOS, Lactose Intolerance | PARTIAL — UserHealthCondition **0 rows** locally |
| `ConditionRule` (:668) | condition→attribute block/warn + clinical fields (ruleCode, clinicalAction, evidence ref, reviewStatus, version, reviewer) | EXISTS — 34 rows, **all DRAFT** |
| `HealthConditionNutrientRule`/`RuleEvidence` (:1927/1911) | threshold rules w/ applicability criteria, clinician-limit support, evidence citations | EXISTS — 14 rules / 21 evidence, all DRAFT |
| `FoodPreference` (:1447) | LOVE/LIKE/NEUTRAL/DISLIKE/NEVER_RECOMMEND per foodName | EXISTS — 76 rows |
| `UserPlanningPreferences` (:1426) | dietaryRestrictions (`DIETS` + `exclude:` + `cuisine:`), availableEquipment (5-value enum), budgetLevel, cookingSkill, householdSize, mealPrepStyle | PARTIAL — equipment enum tiny; restrictions validated by `planningPolicy.validatePreferences` |
| `FoodInventory` (:1529) | per-user pantry stock w/ quantityG + expiration | EXISTS — unused by matching today |
| `FoodLog` (:203) | meal logging incl. `ingredientId`, `nutritionSnapshot`, `micronutrients` | EXISTS — 246 rows |
| `MealRecommendation`/`RecommendationViolation`/`SafetyAuditLog` (:731/762/791) | recommendation + violation + audit persistence | EXISTS — 0 rows; SafetyAuditLog written by safetyPipeline only |
| `ScenarioDefinition` (:3878) | scenario registry rows (`category`, `priority`, `expected`, `data`, `reviewStatus`) | EXISTS — 120 rows all `pending_review` |
| `GroceryItem` (:369) | missing-ingredient grocery list | EXISTS |
| `MacroGoal`/`User.goalType` | targets basis | EXISTS |

### 2.2 Services

| Service | What it does | Reuse for this feature |
|---|---|---|
| `safety/safetyPipeline.js` + `ingredientValidator` + `supplementValidator` + `nutritionValidator` | orchestrates ingredient-attribute blocks (APPROVED rules only), supplement timing, target-deviation warnings; writes SafetyAuditLog | Extend as the inner validation stage — not a competing engine |
| `safety/contextBuilder.js` | assembles conditions/allergies/today's intake/recovery/weight/time | Basis for the normalized constraint object (needs preferences, equipment, pantry, life-stage) |
| `mealSuggestion.js` | occasion resolution; **hard eligibility** (allergy keywords, NEVER_RECOMMEND, dietary restrictions, APPROVED condition blocks) then explainable ranking | Reference implementation for hard-filter ordering; allergen keyword tables to be subsumed by taxonomy |
| `recipeMatch.js` | relational ingredient→recipe matching; catalog resolution (ids/identityKeys/names+aliases); pantry staples; quantity sufficiency; allergy + diet exclusion (recipe `allergens[]` + catalog `sourceRecord.allergens`); status/reasons output | Directly reusable for "cook with what I have"; **constraint inputs are client-supplied (F-1)** |
| `nutritionRecommendation.js` | suggestMeals: eligibility → gap-fit scoring → optional AI re-rank (IDs-only payload, re-validated server-side, deterministic fallback) | Pattern for bounded AI participation |
| `recipes.js POST /:id/customize` | AI proposes line edits only; backend re-resolves every name via catalog, clamps amounts (0–2000g), rejects catalog-unknown/allergen-conflicting changes, recomputes nutrition via `computeFromLines`, returns `proposedLines` (transient) | Closest existing AI containment; **allergies from request body (F-1)**; custom variant never persisted or revalidated against instructions |
| `recipeImport.js` | idempotent catalog import; `computeFromLines` per-100g math; conflict-safe upserts | Reuse `computeFromLines` for generated-recipe nutrition |
| `nutrition.js` | `scale`/`recipe` per-100g math, `fromIngredient`, null-preserving totals | Reuse |
| `nutrients/foodIntelligence.js` + `conditionEvaluation.js` | verified-profile recipe nutrition w/ retention gate; APPROVED-rule evaluator (INSUFFICIENT_DATA discipline, clinician limits, applicability criteria, conflict detection, evidence validity) | The *only* sanctioned clinical-rule executor — reuse for medical stage |
| `nutrients/matching.js`, `ingredientCsv.normalize` | name normalization, Indian alias handling | Reuse |
| `aiProvider.js` | `askJSON` strict JSON-schema (OpenAI structured outputs), per-user daily call+token caps, kill switch, 30s timeout, error mapping (429→503, timeout→504, malformed→502), refusal detection | The AI front door — generation must go through it |
| `aiWeeklyGenerator.js` / `weeklyDietGenerator.js` | AI drafts weekly plan → deterministic re-enforcement of every rule | Reference for generate→revalidate loop |
| `decisionEngine.js` | ESCALATION/WARNING/REVIEW/ASK/FEEDBACK outcomes | Reuse outcome vocabulary for validation decisions |
| `calorieSafety.js`, `scenarioCapabilities.js` | policy helpers (raw↔cooked factor, serving rescale, caution gating) | Reuse pure helpers |
| `featureFlags/` + `config/featureRegistry.js` + `requireFeature` | server-side flags, precedence (kill switch > env > provider > default), fail-closed for `group:'ai'` | New flag `ai_recipe_generation` (group ai, default false) |
| `energySummary.js`, `nutrientStatus.js` | intake target + logged-state context | Ranking context only — never a hard gate |
| `rateLimiter`/`foodQuota`/`persistentLimiter` | IP + per-user limits, AI photo budget | Generation needs its own quota lane (or reuse pattern) |

### 2.3 Routes/API

`GET /meal-suggest` · `POST /recipes/match-ingredients` · `GET /recipes/search` · `GET /recipes/:id` · `GET /recipes/:id/nutrition` · `GET /recipes/:id/intelligence` · `PUT /recipes/:id/engagement` · `POST /recipes/:id/customize` · `POST /recipes` (user recipes) · `POST /meals/ingredient-nutrition` · `POST /safety/validate/{ingredients,supplements,recipe}` · `GET /safety/{recommend,coaching,context}` · `GET /recommendations/nutrition-status` + suggest route · `POST /food-logs` · grocery CRUD.

Auth posture: global `authenticate` middleware rewrites `x-user-id` from the token and strips `req.query.userId`; `requireVerifiedEmail`; per-user + per-IP rate limits; view-as is read-only SUPER_ADMIN. Legacy header auth exists only under `AUTH_TEST_BYPASS`.

### 2.4 Mobile

| Surface | State |
|---|---|
| `RecipeByIngredients.tsx` | chip input → `matchIngredientsV2` → status/missing chips → Cook / +List / quick-log |
| `CookingModeScreen.tsx` | detail, servings scaler, ingredient checklist + missing flags, step-by-step w/ safetyNote display, AI customize box (`recipeCustomizationAi` flag), grocery handoff, **logs via `useMeals().add` (offline path) with `nutritionSnapshot{recipeId,servings,customized}`** |
| `WhatShouldIEatScreen.tsx` | `suggestMeals` list w/ completeness labels, reasons, warnings, disclaimer |
| `SuggestScreen`, `LogMealScreen`, `FoodEntryScreen`, `PortionAdjustScreen` | logging/portion flows exist |
| `api/cooking.ts`, `api/recipes.ts`, `api/mealSuggest.ts`, `api/nutrition.ts` | typed clients for all of the above |
| `gateScreen` + `FeatureFlagsContext` | root-nav gating convention exists |

### 2.5 Tests already covering this area

`tests/smartKitchen.test.js` (match v2 contract incl. allergy exclusion, pantry, quantity, customize validation incl. provider failure propagation), `tests/mealSuggest.test.js` (hard filters, APPROVED-gate, DRAFT-inert), `tests/recipes.route.test.js`, `tests/safety.test.js`, `tests/conditionRules.test.js`, `tests/scenarioFixtures.test.js` + `data/scenarioFixtures.json` + `scripts/scenario-matrix.js` (executable-scenario harness), `tests/aiSchemas.review.test.js`, `tests/aiProvider.review.test.js`, `tests/foodIntel.test.js`, `tests/nutrientPopulation.test.js`. Jest config picks up `tests/`; suites create prefixed fixtures and (post-cleanup) mostly self-clean.

---

## 3. Phase-by-phase gap matrix

| # | Master-prompt requirement | Status | Where / what exists | Gap & proposal |
|---|---|---|---|---|
| 0 | Repo/DB discovery + audit doc | **DONE** | this file; `docs/nutrition-intelligence/*` | — |
| 1 | Normalized constraint engine | **PARTIAL** | `contextBuilder` (conditions, allergies, intake) + per-service loaders | No single object distinguishing hard-medical / allergy / intolerance / religious / dislike / limits / soft / equipment / availability / unknown. **Build `services/recipes/constraints.js`** merging server-side records (UserAllergy, UHC+rules, FoodPreference NEVER_RECOMMEND/DISLIKE, UserPlanningPreferences, FoodInventory, MacroGoal) + permitted request overrides; classify each constraint `hard\|soft`, `source`, `resolved\|unknown`. Must fix F-1: request params may *narrow* results, never *widen* beyond server profile |
| 1.1 | Allergies + derivatives/hidden | **PARTIAL** | `ALLERGEN_KEYWORDS` (mealSuggestion) covers whey/casein/tahini/anchovy-class terms by keyword; recipe `allergens[]` + catalog `sourceRecord.allergens` checked in match/customize | Keyword matching has no derivative provenance, no cross-contact state, no severity, no "unknown → fail closed" per-allergen. **Build allergen/derivative map as reviewed data** (canonical allergen → derivative terms incl. sauces/oils/extracts w/ per-derivative risk class), used by all paths; unresolved composition under declared-severe allergy → `NEEDS_REVIEW` not pass |
| 1.2 | Medical restrictions w/ rule metadata | **PARTIAL** | `ConditionRule` + `HealthConditionNutrientRule` + `RuleEvidence` + `ClinicalRuleReview` + DB CHECK on APPROVED + `conditionEvaluation` (version, evidence validity, applicability, clinician limits, conflicts, INSUFFICIENT_DATA) | Governance skeleton is strong and correctly inert (everything DRAFT). Missing: condition breadth in rules, population context fields (life-stage/medication/ED — unpopulated per prior audit), and rule-authorship for recipe context. **Do not invent thresholds** — new rules enter as DRAFT data requiring reviewer |
| 1.3 | Conflicting conditions | **PARTIAL** | `decisionEngine` has `conflicting_conditions` trigger; `conditionEvaluation` detects PRIORITIZE-vs-LIMIT conflicts | No populated triggers; no recipe-space conflict resolution. Hard rules must dominate optimization; infeasible ⇒ `NO_ELIGIBLE_RECIPE` typed result (doesn't exist today) |
| 2 | Personal/cultural/religious exclusions | **PARTIAL** | `FoodPreference.NEVER_RECOMMEND` (hard), `dietaryRestrictions` enum (10 patterns + `exclude:`/`cuisine:`), keyword matching in two implementations | No hierarchy (fish→anchovy), no derivative expansion ("no beef"→stock/gelatin), no halal/kosher/jain enum values, dislikes as *hard* exclusions need explicit user confirmation semantics. **Extend DIETS + build category taxonomy (§Phase 3); add confirmation flow semantics: requests may add one-off exclusions but never mutate saved profile silently** |
| 2.1 | Dietary patterns (veg/vegan/halal/kosher/Jain…) | **PARTIAL** | `DIET_RULES` (recipeMatch) + `RESTRICTION_KEYWORDS` (mealSuggestion) + `DIETS` (planningPolicy) — three divergent implementations | Consolidate into one taxonomy-driven pattern engine; halal/kosher must be *declared-unverifiable* without sourcing data (NEEDS_CLARIFICATION posture, never certified claims) |
| 2.2 | Preference conflicts | **MISSING** | — | No explicit conflict detection (e.g., vegetarian + "chicken"). Needs `NEEDS_CLARIFICATION` outcome + confirm-before-persist rule |
| 3 | Ingredient intelligence layer | **PARTIAL** | catalog aliases/category/preparation; USDA-backed `Ingredient`; verified profiles; `IngredientServing`; alias map incl. Indian names | No parent/child taxonomy, origin (animal/plant), derivative-of edges, edible-portion/yield factors, confidence/verification date per row; categories case-inconsistent; 55/1714 recipe lines unlinked; unresolved lines can pass validation today. **Add taxonomy metadata (new tables or reviewed data file + `IngredientCatalog` fields); unresolved ⇒ `unresolvedIngredients[]` blocking critical stages** |
| 4 | AI candidate generation | **MISSING** | `askJSON` strict-schema infra; aiWeeklyGenerator precedent | Build `services/recipes/generate.js`: prompt = normalized constraints + available ingredients + budget + equipment + cuisine + time; strict JSON schema (name, lines w/ catalog refs + grams + optional flag, steps w/ minutes/temps/safetyNotes, servings); 2–3 candidates; AI never emits nutrition numbers (compute server-side via computeFromLines/foodIntelligence) |
| 4.1 | AI failure modes → controlled responses | **PARTIAL** | provider maps quota/timeout/refusal/malformed; customize rejects bad lines | Need schema-validation layer on candidates (hallucinated IDs, unused lines, instruction↔ingredient cross-check, implausible temps/times), injection screening on ingredient names, typed failure outcomes |
| 5 | `validateGeneratedRecipe` pipeline | **PARTIAL** | `runSafetyPipeline` (ingredients/supplements/nutrition), conditionEvaluation | Missing: schema→identity→quantity→decomposition→allergen→exclusion→pattern→medical→nutrition→feasibility→food-safety→servings→substitution→eligibility staging w/ rule IDs + `PASS/FAIL/NEEDS_CLARIFICATION/NEEDS_REVIEW` contract. **Build `services/recipes/validate.js` orchestrating existing validators + new stages; critical-unresolved ⇒ not PASS** |
| 5.1 | Revalidation triggers | **MISSING as policy** | every request recomputes (no stored verdicts to go stale); `foodIntelligence` memo keys include full context (correct pattern) | Define invalidation set (ingredients/qty/method/substitution/profile/rule/data changes; save/copy/share/plan regeneration); a `validationHash` on stored results |
| 6 | Nutrition engine | **PARTIAL** | per-100g macros w/ null discipline; `recipe()`/`scale()`/`computeFromLines`; verified profiles w/ retention gate; `aggregateRecipe` labels approximation | Micros (sodium/potassium/phosphorus) exist only via sparse profiles; no oil-absorption/marinade/drained-solids models; raw↔cooked requires explicit factor (`convertFoodState` correct-by-refusal); provenance/calc-version partially stored. **Compute generated-recipe nutrition server-side only; block unqualified pass when uncertainty touches an active hard limit** |
| 7 | Food-safety validation | **MISSING** | `instructions[].safetyNote`/`safetyNotes` fields (display only) | No temperature/method/prep rules. **Build deterministic `foodSafety.js` rule table (e.g., poultry 165°F/74°C, ground vs whole cuts, eggs, seafood, leftovers, raw flour) keyed off parsed instruction text + ingredient classes; unverifiable ⇒ NEEDS_REVIEW; never infer doneness from appliance timers** |
| 8 | Regeneration/fallback | **MISSING** | customize's per-change rejection; weekly generator's replace-not-patch | Implement bounded correction loop (failed rule IDs → constrained retry → full revalidation → max attempts → verified-recipe fallback → `NO_ELIGIBLE_RECIPE`) |
| 9 | Ranking/personalization | **PARTIAL** | mealSuggestion scoring (occasion/preference/familiarity/portion-share), suggestMeals gap-fit, recipeMatch score+reasons | Three rankers; consolidate per PIPELINE.md decision; ranking operates only post-hard-filter; keep reasons explainable |
| 10 | Transformations | **PARTIAL** | `/customize` free-text edits | Add typed transforms (spice, cuisine, oil, protein, carb, veg/vegan swap, method, servings, time, budget) → full revalidation + nutrition recompute; customize today does **not** re-run condition/allergen gates server-side (F-1) or re-check instruction consistency |
| 11 | 5-screen UX | **PARTIAL** | ingredient chips + match + cooking mode + log + grocery (screens ≈ 1,3,4,5) | Missing: dedicated "feel like eating" preference screen (cuisine/time/method/spice/kcal/protein/exclusions), equipment capture, quantities entry, structured results w/ reason display, log-with-adjustments flow |
| 12 | Storage/caching/provenance | **PARTIAL** | `reviewStatus` lifecycle, `nutritionSource` provenance, `foodIntelligence` context-keyed memo | Add: generation provenance (model, prompt hash, timestamp), validation verdict + rule versions + input hash, lifecycle separation (AI_GENERATED vs VERIFIED vs KITCHEN_TESTED — never auto-promote), per-user validation never shared via cache |
| 13 | Security/privacy | **PARTIAL** | auth rewrite, RBAC, rate limits, AI quota+kill switch, minimized re-rank payload precedent | F-1 fix (server-side constraints); injection screening on free-text/ingredient names; generated-recipe content must not leak other users' data; cross-user isolation tests (creator-scoped recipes already enforced in queries); privacy-conscious audit logging (constraint classes, not diagnoses) |
| 14 | Scenario/test matrix | **PARTIAL** | 120-scenario registry + fixture harness + matrix generator + strong test culture | Author recipe-intelligence scenario registry (data file + `ScenarioDefinition` or parallel runner) covering the 50 required categories incl. adversarial (injection, hallucinated IDs, unit confusion, stale prefs) and NO_ELIGIBLE_RECIPE |
| 15 | DB quality audit | **PARTIAL** | `DATA_QUALITY.md` + `scripts/audit-junk-data.js` | New recipe-intelligence pass needed: allergen coverage 93/258 recipes + 101/228 catalog, category case-dupes, 0 UHC rows, instructions coverage 108/258, yield gaps — report doc to write |
| 16 | E2E validation | **MISSING** | e2e harness precedent (`tests/integration/platformE2E.test.js`) | Build synthetic-profile E2E across the generation pipeline incl. flag-off, stale-cache, cross-user |
| 17 | Observability | **MISSING** | `ApiUsage`, `SafetyAuditLog`, PostHog events elsewhere | Metrics: generation success, validation-failure categories, retry count, latency, tokens, unresolved-ingredient rate, safety-incident alerts — privacy-minimized |
| 18 | Progress/resumability | **DONE** | `IMPLEMENTATION_PROGRESS.md` (this program), prior `STATUS.md` convention | Maintain per milestone |
| 19 | Release gates | **PARTIAL** | flag infra + kill switch + `RELEASE_READINESS`/`CLINICAL_RELEASE_GATES` precedent | Recipe-intelligence gate checklist to author; keep flag OFF until critical allergy tests pass |
| 20 | Deliverable docs | **PARTIAL** | this file + progress | Write the remaining docs as phases land |

---

## 4. What is complete vs. partial vs. missing (rollup)

**Complete enough to rely on:** auth/identity + RBAC + rate limits; AI provider containment (strict schema, quota, kill switch); feature-flag precedence + middleware; clinical-rule governance (APPROVED-only + CHECK + evidence validity + INSUFFICIENT_DATA); per-100g nutrition math with null≠zero; recipe match v2 mechanics; cooking-mode + logging UX; scenario harness; audit-log tables.

**Partial (extend, don't rebuild):** constraint/context assembly; allergen & diet exclusion (keyword → taxonomy); clinical condition coverage (infra strong, data all-DRAFT and unpopulated on users); nutrition (macros solid, micros/yield/retention sparse); AI participation (re-rank + line edits exist, generation doesn't); recipe lifecycle (statuses exist, no AI_GENERATED/validation provenance); UX (3 of 5 screens approximate).

**Missing (build):** normalized constraint object; allergen/derivative taxonomy w/ hierarchy; AI candidate generation; staged `validateGeneratedRecipe` w/ typed outcomes; food-safety rules; regeneration loop; transformation revalidation; generation observability; recipe-intelligence scenario registry; NO_ELIGIBLE_RECIPE contract.

**Needs refactoring/decision (carry-over, not blocking):** 3 recommenders + 3 scorers consolidation (D2 open); 12 normalizedName dup groups; `peanut`/`Peanuts`; `Recipe.fiberG @default(0)`; 1817 `@test.dev` users; catalog category case-normalization.

---

## 5. Existing tests — what they actually cover for this feature

- **match-ingredients:** coverage/status/quantity/pantry/allergy-exclusion/diet-exclusion/maxPrep/id+identityKey resolution — solid but allergy params are client-supplied.
- **customize:** valid sub recompute, unknown ingredient reject, bounds reject, allergen-conflict reject (via client-supplied list), empty-recipe 422, provider-failure propagation, missing-request 400.
- **meal-suggest:** hard filters (allergies, NEVER_RECOMMEND, restrictions, APPROVED condition blocks incl. DRAFT-inert), plan-item honoring, emptyReason.
- **safety pipeline:** ingredient condition blocks, supplement timing, recipe/meal validation shape, audit-log write.
- **conditionEvaluation:** APPROVED gating, evidence validity, applicability criteria, clinician limits, conflicts, INSUFFICIENT_DATA statuses.
- **scenario harness:** 120-scenario registry for *nutrition* domain, 68/120 executable — reuse the runner pattern for recipe scenarios.

**Not covered today:** AI *generation* output validation, instruction parsing/food safety, cross-user recipe isolation (only grocery tested), injection via ingredient names, regeneration, transformation revalidation, serving-consistency, no-eligible-recipe contract, flag-off behavior for a generation endpoint, observability.

---

## 6. Integration risks & security findings

| ID | Severity | Finding |
|---|---|---|
| **F-1** | **High** | `matchIngredients` + `/customize` take `allergies`/`diet` from request body only; server profile never consulted → constraint bypass via client. Fix in Phase 1 (server merge; client params narrow-only). Add cross-user + tampering tests. |
| **F-2** | Medium | `UserHealthCondition` = 0 rows locally → medical paths exercised only via fixtures; staging/prod verification must use synthetic profiles. |
| **F-3** | Medium | Three divergent allergen/diet keyword sets (`mealSuggestion` vs `recipeMatch` vs `planningPolicy`) — a recipe can be excluded on one surface and allowed on another. Taxonomy consolidation is a *safety* refactor, not just hygiene. |
| **F-4** | Medium | RESEARCH_DRAFT recipes (230/258) are browsable and matchable (labeled ESTIMATED). Generated recipes must get a distinct, non-VERIFIED status and never leak into "verified" claims. |
| **F-5** | Medium | `/customize` never re-checks instruction↔ingredient consistency (a swap can orphan a step that references the old ingredient) and never persists the variant's validation — pattern to fix in the new transform path. |
| **F-6** | Low | Spoonacular fallback path returns external recipe titles/nutrition with zero safety filtering — acceptable today (display/log aid only), must not feed the recommendation path. |
| **F-7** | Low | `safety.js` handlers swallow errors to `res.status(500)` w/o `next()` — pattern diverges from global error handler; keep consistent in new routes. |
| **F-8** | Info | `aiProvider` quota is in-process (single instance assumption — documented). Generation adds call volume; budget accordingly. |
| **F-9** | Info | `Recipe.recipeName` is `@unique` globally — generated names must be disambiguated (sourceKey/uuid suffix) or collisions will 500. |

---

## 7. Database quality snapshot (read-only, 2026-11-21)

| Area | Numbers | Issues |
|---|---|---|
| Recipe | 258 total: 230 RESEARCH_DRAFT, 28 SYSTEM, **0 VERIFIED** | 0 rows kitchen-verified |
| | nulls: finishedYieldG 28, prepMinutes **150**, cuisine 28, description 28, calories 0 | most recipes can't be time-filtered |
| | instructions present 108/258; `safetyNotes` used sparsely; allergens declared **93/258** | 165 recipes rely on name-matching for allergen exclusion |
| | servings ≤0: 0 ✓ | — |
| RecipeIngredient | 1,714 lines, 55 unlinked (was 93 — improving) | unlinked lines can't get verified nutrition |
| Ingredient | 420 rows; noFiber 21; zeroKcal 3; noFdc 244; over900kcal 0 ✓ | mostly catalog-sourced |
| IngredientCatalog | 228 rows; allergens metadata **101**; categories case-inconsistent (`Vegetable`/`vegetable`, `Dairy`/`dairy`, `Spices`/`spice`/`condiment`) | taxonomy normalization needed before hierarchy work |
| Nutrition layer | 27 nutrients, 18 verified profiles, 486 nutrient rows | thin verified coverage (documented: 349 no-match + 161 unavailable) |
| Rules | ConditionRule 34 all DRAFT; HealthConditionNutrientRule 14 all DRAFT; RuleEvidence 21 | inert by design; approval needs clinician |
| HealthCondition | 22 canonical incl. Pregnancy/Prediabetes/PCOS/High LDL/Hypertriglyceridemia/Iron Deficiency/Lactose Intolerance | good base set |
| Allergy | **2 rows**: `Peanuts`, `peanut` (near-dup open) | allergen catalog itself is nearly empty — user allergies reference free-form names |
| User linkage | UserAllergy 76; **UserHealthCondition 0**; UserPlanningPreferences w/ restrictions 74 (all `dairy_free` — test-pattern) | conditions never fire for real users locally |
| FoodLog | 246 | — |
| Scenarios | 120 pending_review | — |

Full write-up to be produced in `database-quality-report.md` during Phase 15; counts above are the Phase-0 baseline.

---

## 8. Proposed implementation sequence

Sequenced safety-first; each step independently testable behind `ai_recipe_generation` (new flag, `group:'ai'`, default false, fail-closed).

1. **Constraint normalization** (`services/recipes/constraints.js`) — merge server records + narrowing-only request overrides; closes F-1 for the new path *and* retrofit `match-ingredients`/`customize` to the same loader.
2. **Ingredient taxonomy + allergen/derivative map** — reviewed data module (`data/recipe-intelligence/allergen-map.json` or tables), category normalization; unify the three keyword sets.
3. **`validateGeneratedRecipe`** — staged pipeline reusing safetyPipeline validators + conditionEvaluation + new stages (schema, identity, quantities, taxonomy checks, instruction cross-check, food-safety table, servings consistency) returning `PASS|FAIL|NEEDS_CLARIFICATION|NEEDS_REVIEW` + rule IDs.
4. **AI generation** — `generate.js` via `askJSON` (strict schema; AI proposes names/lines/steps only; nutrition computed server-side); injection screening; typed provider-failure mapping.
5. **Regeneration + fallback** — bounded retries w/ rule-ID feedback, verified-recipe fallback, `NO_ELIGIBLE_RECIPE`.
6. **Schema (additive)**: generation provenance + validation verdict fields on Recipe (or sibling table), `AI_GENERATED` reviewStatus handling, RecipeRevision-ish linkage for transforms — `migrate diff --create-only` flow per AGENTS.md, never `migrate dev`.
7. **Transformations** — typed transforms reusing `/customize` mechanics + full revalidation.
8. **Ranking consolidation** — one post-filter ranker path for generated + catalog candidates.
9. **Mobile screens 1–2 + polish** — equipment/quantity capture, "feel like eating" prefs, eligibility-aware results, log-with-adjustments.
10. **Scenario registry + test matrix** — recipe-intelligence JSON + runner mirroring `scenario-matrix.js`; adversarial + no-eligible + cross-user suites.
11. **DB quality report** — extend audit script for recipe-intelligence checks.
12. **Observability + release gates** — metrics, alerts, `release-readiness.md`, keep flag OFF pending gates.

Hard guardrails for all steps: APPROVED-only clinical rules; missing≠zero; AI numbers never trusted; hard filters precede ranking; no weakening to raise success rate; additive migrations only via reviewed SQL.

## 9. Resumption

Next session: read `IMPLEMENTATION_PROGRESS.md` → this file's §8 → `docs/nutrition-intelligence/STATUS.md`. Do not `migrate dev`/`reset`. Junk/quality scripts are dry-run first.
