# Smart Fiber Intelligence — Implementation Progress

Status: **Implementation complete — all flags OFF pending staged rollout** · Last updated: 2026-11-23

Core principle: fiber-first (not simply vegetable-first), food-first,
supplement-optional, safety-first. Missing nutrient values are never zero;
only confirmed consumption counts toward confirmed totals.

---

## 1. Existing capabilities found in the codebase

### Fiber data model (already present — reuse, do not duplicate)

| Model | Fiber field(s) | Notes |
|---|---|---|
| `FoodLog` | `fiberG Float?` | Nullable — `null` = unknown, never treated as 0. `nutritionSnapshot.nutrientUnknowns` records unmeasured keys. `nutritionSnapshot.components[]` already stores per-component ingredient lines from photo scans. |
| `Ingredient` | `fiberPer100g Float?` | Per-100g basis; `IngredientServing` provides gram conversions. |
| `IngredientNutrient`/`Nutrient` | `FIBER` nutrient code exists | `nutrientMaster.js` seeds `FIBER` (g, MACRO). `IngredientNutritionProfile` carries per-preparation (raw/cooked) verified profiles. |
| `Recipe` | `fiberG Float? @default(0)` | ⚠ default 0 — audit whether 0 means "none recorded". `RecipeIngredient` has per-line macros but **no fiberG column**. |
| `Supplement` | `fiberG Float @default(0)` | Per serving from label. |
| `SupplementLog` | `fiberG Float @default(0)` | Per log. |
| `SupplementProduct` | `labelFacts Json`, `servingSize`, `servingUnit`, `servingText`, `warnings`, `verificationStatus` | The verification pathway the spec requires already has a home. `SupplementProductIngredient.amountKnown=false` = declared-but-unquantified. |
| `MacroGoal` | `fiberTarget Float @default(30)` | Static default — **this is what Phase 2 replaces with a personalized value**. |
| `DailyMacroScore` | `fiberScore`, `fiberG` | Cached daily scoring. |
| `WeeklyNutritionPlan`/`WeeklyMeal` | `fiberTarget`, `fiberG` | Planned-meal fiber exists → feeds "planned fiber" state. |
| `ScannedLabel` | `labelFiberG`, `adjFiberG` | Label-scan pipeline already fiber-aware. |
| `Habit` | `kind` includes `'fiber'` | Habit engine already knows fiber habits. |

### Deterministic engines (reuse)

- `services/nutrientCompleteness.js` — `unknownsFor(log)`, `coverageFor(logs)`: exactly the confirmed/estimated/unknown distinction the spec needs.
- `services/mealNutrition.js` — `computeMealNutrition(userId, {items})`: per-line `fiber_g`, `fiberKnown`, totals, `fiberComplete`, unresolved list. Deterministic, no AI.
- `services/nutrition.js` — `scale()`/`recipe()` keep `null` fiber as `null`.
- `services/calorieEngine.js` — BMR (Mifflin-St Jeor), TDEE, `targetCalories`, `normalizeGoal`. Input for the 14 g/1,000 kcal rule.
- `services/macroScoreService.js` — `getGoals`/`updateGoals`/`calculateScore`; fiber already scored vs `MacroGoal.fiberTarget`.
- `services/gutHealth.js` — 14-day fiber average vs static `FIBER_TARGET_G = 30`, plant variety, symptom journal, food tolerances.
- `services/trends.js` — `avgFiberG` vs `macroGoal.fiberTarget`, `fiberBelowTargetPct: 0.7` insight.
- `services/healthScoreEngine.js` — fiber contributor (+8/−5), refined-carb-low-fiber penalty.
- `services/ingredientImpact.js` — `classifyFood` categories incl. `legumes_soy`, `whole_grain`, `refined_carb`, `fruit_vegetable`, `nuts_seeds`, `protein_foods`; `evaluatePortion`; `suggestSubstitutions` (already suggests "vegetable or fruit side" when `fiberG < 3`). Reusable taxonomy for sequencing.
- `services/nutrientStatus.js` — per-nutrient totals + `coverage: complete|partial|none` over 1–30 days.
- `services/todayActions.js` — health-priorities engine already emits a `fiber_variety` card (`weight 50`) from gut-health signals.
- `services/decisionEngine.js` — deterministic outcome resolution: `medical_escalation | safety_warning | professional_review_required | need_more_information | auto_feedback`. `LIFE_STAGE_BLOCKS` incl. `under_18`, `pregnancy`.
- `services/safety/safetyPipeline.js` + `supplementValidator` + `ingredientValidator` — legacy gate.
- `services/supplements/safetyEngine.js` — v2 supplement safety: only `approved && PUBLISHED` `SupplementInteractionRule`s fire; unverifiable composition reported as unknown; explicit info-limits.
- `services/safety/contextBuilder.js` — user condition/allergy context.
- `services/featureFlags/*` + `middleware/requireFeature.js` — server-authoritative flag enforcement, `dependsOn`, AI kill group.
- `services/reminders/*` — reminder pipeline with consent gates, quiet hours, daily cap, per-category cooldown, dedupe keys, `ReminderSuggestion`.
- `services/localDay.js` — canonical timezone day boundaries.
- `services/foodDetector.js` — `detectedFoods[]` (≤6 meal components, visible/hidden ingredients, portionGrams).
- `services/photoRecipeMatcher.js` — deterministic recipe matches per detected component.
- `services/foodIntel.js` — fiber-aware food intelligence (oats/flax/fenugreek entries exist).
- `routes/voice.js` — Hey Leo: `LOG_FOOD` writes `fiberG`, `MARK_SUPPLEMENT_TAKEN` writes `SupplementLog.fiberG`.
- `routes/chat.js` — Leo chat + post-generation safety suppression pattern.
- `routes/foodLogs.js` — FoodLog create computes `nutrientUnknowns`, provenance, catalog-revision staleness.
- `routes/supplements.js` — `/doses/:id/action`, `/log`, `/timing/:id`, `/safety`, `productLabelRequired` flag already surfaced from `SupplementEducation.labelExceptions`.
- Supplement research seed (`data/imports/humai_supplement_research_seed_v1.json`) already contains **Psyllium husk** (`ADD_CANDIDATE`, `product_label_required: true`, `requires_clinical_review: true`, `suggestion_auto_enabled: false`, MedlinePlus source) plus acacia, PHGG, glucomannan (review-only), wheat dextrin.
- `prisma/seed-foods.js` — ingredient/recipe seed writer already persists `fiberPer100g`.

### Mobile

- `featureKeys.ts` + `FeatureFlagsContext` + `betaFeatures` build gates — add fiber keys here.
- `PhotoMealScreen` — component-level review flow; `nutritionSnapshot.components` written on log; fiber total shown at confirm.
- `DashboardScreen` — fiber macro tile already renders (`summary.fiber` vs `goals.fiberTarget`).
- `api/meals.ts` — `NutritionLine.fiber_g/fiberKnown`, `fiberComplete` typed.
- `services/reminderSync.ts`/`reminderPlan.ts` — local notification merge/dedupe machinery; supplement-dose channel exists (`supplement-dose|<occurrenceId>`).
- `services/safetyInvalidation.ts` — invalidation bus; subscribers refetch.
- `design/components.tsx` — `Card, Copy, Action, Field, Segmented, ListRow, Notice, Skeleton, Progress, Toggle, TimeChips`.

## 2. Gaps (what does NOT exist yet)

1. **Personalized fiber target** — `MacroGoal.fiberTarget` is a static 30 default; no 14 g/1,000 kcal derivation, no age/sex/life-stage/condition adjustments, no provenance field.
2. **Fiber status taxonomy** — no confirmed/estimated/unknown/planned/suggested split of daily fiber.
3. **Meal sequencing engine** — no component ordering anywhere (`sequenc` grep: zero hits in backend).
4. **DailyFiberRecommendationEngine** — no dedicated fiber progress/gap endpoint.
5. **Psyllium product pathway** — `SupplementProduct` can hold label data, but no teaspoon→gram conversion field, no fiber-per-serving verification flow, no eligibility check for bulk-forming fiber.
6. **Fiber reminders** — no fiber category in reminder engine; `fiber_variety` exists only as a today-action.
7. **AI/voice fiber grounding** — chat has no deterministic fiber context injection; voice has no fiber intents.
8. **Feature flags** — none of the `fiber_*` keys exist.
9. **RecipeIngredient.fiberG** missing (recipe lines carry 4 macros only) — fiber falls back to recompute from `Ingredient.fiberPer100g`.
10. **Data audit** — no record of which ingredients lack `fiberPer100g`.

## 3. Architecture decisions

- **D1** — One new flag family in `featureRegistry.js` (class `server`, group `manual`, all default `false`): `fiber_intelligence_enabled` (parent), `fiber_meal_sequencing_enabled`, `fiber_daily_goal_enabled`, `fiber_reminders_enabled`, `fiber_supplement_suggestions_enabled` (also `dependsOn: ['supplements']`), `fiber_ai_enabled` (class `ai`, group `ai`), `fiber_voice_enabled` (class `ai`, group `ai`). Enforcement via `requireFeature`.
- **D2** — Personalized target is **computed, not stored**, as the default: `fiberTarget = round(14 × calorieTarget/1000)` when no override exists, with provenance (`formula|custom|clinician|default`). Stored overrides keep `MacroGoal.fiberTarget` + new `fiberTargetBasis`/`fiberTargetNote` columns. Resolution order: clinician restriction → custom override → formula → static default.
- **D3** — Fiber status per day: `confirmed` (sum of `fiberG` where `fiberG` measured), `unknownCount` (logs where fiberG unknown via `nutrientCompleteness`), `planned` (today's `WeeklyMeal.fiberG` not yet logged), `estimated` (scan-time AI/labeled estimates not yet confirmed). Only `confirmed` counts.
- **D4** — Sequencing = new deterministic service `services/fiber/sequencing.js` consuming `nutritionSnapshot.components[]` (or `computeMealNutrition` lines) + `classifyFood` categories. Only non-starchy-vegetable-first order is asserted; mixed dishes get `separable: false`. Output carries `evidence` + `optional` framing, never glucose-spike guarantees.
- **D5** — `DailyFiberRecommendationEngine` = `services/fiber/dailyEngine.js`, recompute-on-read (like `macroScoreService.calculateScore`), persisted snapshots in new `FiberDailyRecommendation` table for invalidation/audit; `inputsHash` invalidates on log/supplement/health changes.
- **D6** — Psyllium pathway lives inside supplements domain: eligibility = `supplements/safetyEngine` + a new deterministic `fiberSupplementEligibility` check (age ≥18, no dysphagia/obstruction condition match, hydration guidance, medication-spacing warning, no bedtime dosing). Label math only from verified `SupplementProduct` rows; unknown tsp→g conversion returns `fiberUnknown: true` + request-label UX. Never auto-logs; explicit user confirm → existing `/supplements/log`.
- **D7** — Reminders reuse `services/reminders/*`: new `fiber` reminder category + dedupe keys (`fiber|<day>|<slot>`), driven off the daily engine; opt-in only; suppressed when `completed`/cap/quiet-hours by the existing gate.
- **D8** — AI/voice: deterministic fiber facts injected as *context* into `aiService`/`voice` system prompts from the same engine (single source of truth); post-generation validation extended to reject fabricated numbers (reply fiber numbers must match engine values or be stripped). `fiber_ai_enabled` in the AI kill group.
- **D9** — DB migration adds only: `MacroGoal.fiberTargetBasis/fiberTargetNote`, `RecipeIngredient.fiberG`, `FiberDailyRecommendation`, `FiberSupplementCheck` (audit of eligibility outcomes). Safe additive migration, `migrate dev --create-only` per repo rules (DB has known drift — never reset).
- **D10** — Docs in `docs/fiber-intelligence/` (this dir): progress, data audit, evidence register, supplement safety review, test results, release readiness.

## 4. Phase plan (execution order)

| Step | Phases | Deliverable |
|---|---|---|
| A | 1 | This document ✅ |
| B | 11 + 2 + 10 | Flags, personalized target engine + `GET /fiber/daily` core, migration ✅ |
| C | 3 + 12a | `FIBER_DATA_AUDIT.md` (187/290 logs null-fiber, 21 ingredients missing, supplement default-0 finding); unit tests ✅ |
| D | 4 + 8a | Sequencing service + `POST /fiber/sequence` (+`?foodLogId`) + `MealOrderCard` in PhotoMeal confirm ✅ |
| E | 5 + 10 | `GET /fiber/daily`, `/fiber/trend`, `/fiber/suggestions`; `inputsHash` invalidation incl. allergies/dislikes; persisted audit rows ✅ |
| F | 6 | `fiber` reminder category (send-time dynamic body, flag-gated planning, `already_completed` suppression) + mobile opt-in + `reminderPlan` skip ✅ |
| G | 7 + 8b | `supplementCheck.js` eligibility + label-verified fiber + `FiberSupplementCheck` audit + `FiberSupplementSheet` ✅ |
| H | 9 | `assistant.js` deterministic grounding; chat intercept (`fiber_ai_enabled`); voice `ASK_FIBER` intent (`fiber_voice_enabled`) ✅ |
| I | 12 + 13 | `TEST_RESULTS.md`, `RELEASE_READINESS.md`, `EVIDENCE_REGISTER.md`, `SUPPLEMENT_SAFETY_REVIEW.md` ✅ |

## 5. Verification recorded

Phase 1 (discovery):
- `grep fiber|Fiber backend` → present in schema + ~100 src matches (listed above).
- `grep sequenc|mealOrder backend` → **none** — sequencing was genuinely new.
- Psyllium seed entry verified in `humai_supplement_research_seed_v1.json` (`ADD_CANDIDATE`, `product_label_required`).
- Prisma drift warning honored: additive-only migration, no `migrate reset`.

Post-implementation (see `TEST_RESULTS.md` for the full matrix):
- Backend: `npx jest --runInBand` → **148/148 suites, 5,796 tests pass**.
- Fiber-focused suites: targets 16, sequencing 9, reminders 9, supplement 18, routes 15, assistant 11 — 68 + 15 route = all pass.
- `npx prisma validate` clean; `npx prisma migrate status` up to date on dev DB.
- Mobile: `npx tsc --noEmit` clean; `npx jest` 77/78 suites pass (DashboardScreen passes standalone after dep-fix); eslint on touched files clean (one `exhaustive-deps` warning class consistent with existing code).
- Live-DB: `/fiber/daily` and `/fiber/trend` return correct personalized values (31 g @ 2,200 kcal); assistant answers dal 17 g/100g verbatim; sequencing orders veg→protein→starch and rejects biryani.

## 6. Deviations from original plan

- **D8 implemented as interception, not prompt injection**: fiber questions in
  chat are answered deterministically by `assistant.js` before reaching the
  LLM (same module serves voice) — the LLM can never fabricate fiber numbers
  because it never sees the question. Stronger than the original context-
  injection design; post-generation validation no longer needed for fiber.
- Reminder weekly-review phase deferred (daily engine only) — recorded in
  RELEASE_READINESS.md limitations.
- Clearing a `MacroGoal` fiber override nulls `fiberTargetBasis` so the
  engine recomputes instead of claiming a stored basis.
