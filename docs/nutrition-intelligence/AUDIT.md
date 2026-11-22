# AUDIT — requirement matrix vs master prompt (2026-11-21)

> **Addendum (2026-11-21 evening):** Data layer populated since this matrix — 27 nutrients, 18 USDA-verified profiles, 12 evidence, 14+3 DRAFT rules, 120 scenarios; "tables empty locally" notes no longer apply. Score-v2 defects B1–B4 fixed; unreviewed-rule consumers gated (B8). Count correction: `ConditionRule` held **80** legacy rows at audit time (not 0); `HealthCondition` 71, `Allergy` 50. See STATUS.md / DATA_QUALITY.md.

Legend: **EXISTS** = implemented & wired · **PARTIAL** = implemented but incomplete/defective · **MISSING** = not present · **UNSAFE** = present but produces wrong/misleading output · **UNVERIFIED** = could not confirm.

## Phase 1 — evidence & policy governance

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Versioned EvidenceSource | PARTIAL | `RuleEvidence` (schema.prisma:1903), `ResearchSource` (:2735), `SupplementEducationSource` (:3689), `ArticleEvidence` (:2833) | Four parallel per-domain evidence tables, no unified registry. `RuleEvidence` has org/title/URL/year/lastReviewed; **no expiry/review-due, jurisdiction, population, certainty grade fields** |
| EvidenceClaim concept | PARTIAL | `IngredientEvidenceProfile.claims` JSON (:3371, claim+verdict+applicability+studyType+dose+limitations+source) | Only for culinary-ingredient education; lifecycle DRAFT→IN_REVIEW→APPROVED→ACTIVE→NEEDS_REVIEW→RETIRED enforced in reads |
| NutritionRule + RuleVersion | PARTIAL | `HealthConditionNutrientRule` (:1918), `ConditionRule` clinical fields (:678-690), `SupplementInteractionRule` (:3722) | `version` int + `reviewStatus DRAFT|REVIEWED|APPROVED` + `reviewedBy/At` exist. Rules are rows, not versioned chains — approval requires new row; no retirement workflow (documented Phase-3 limitation) |
| RuleApproval | PARTIAL | `reviewedBy/reviewedAt` on rules; `ArticleReview` (:2833), `ReviewerProfile` (:2849), `SupplementEvidenceReview` (:3774) | Approval metadata exists per-domain; no cross-domain approval queue or second-reviewer requirement |
| RuleExecution logging | MISSING | — | `SafetyAuditLog` (:783) exists for the old safetyPipeline but 0 rows locally; conditionEvaluation/rule firing is not audited |
| FoodDataProvenance | PARTIAL | `IngredientNutritionProfile.sourceCitation` JSON w/ provider URL, dataType, publicationDate, retrievedAt, SHA-256, CC0 license (:1849-53); `IngredientCatalog.sourceRecord` + `verificationLevel` | Provenance exists but is embedded JSON, not queryable relations; no provenance on `Ingredient` per-100g values themselves |
| Claim-type taxonomy (measured/calculated/policy/association/generated) | MISSING | — | `completenessOf()` in nutritionRecommendation.js:49 distinguishes 3 origin classes for recipes only; no global taxonomy |
| Clinical review gate | EXISTS (design) | `reviewStatus` + `conditionEvaluation.evaluate` (`src/services/nutrients/conditionEvaluation.js:16-21`) — non-APPROVED rules never fire; invalid evidence → INSUFFICIENT_DATA | Enforced in code. Locally nothing is APPROVED, so the gate is untested with live rules |

## Phase 2 — canonical food/ingredient/recipe model

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Per-100g nutrient model | EXISTS | `Ingredient` (:569), `IngredientCatalog` (:1759), `IngredientServing` (:1784) | 529 ingredients; macros only at this level |
| USDA FDC integration | EXISTS | `usdaService.js` (live search), `nutrients/sources.js:fromUsda` (validated import, CC0 provenance, SHA-256), 162 cached source files `data/nutrient-sources/usda/` | Two paths: quick macros (`searchUsda` keeps full nutrients in sourceMetadata) and verified profiles |
| IFCT (ICMR-NIN) | PARTIAL (blocked) | `nutrients/sources.js:fromReviewed` — refuses import without `review.approved` + licenseEvidence | **No licensed export exists** — deliberate gate, not a gap to code around |
| Micronutrient profiles | PARTIAL | `IngredientNutritionProfile`+`IngredientNutrient` (:1841-75), `Nutrient` master (:1829) + `nutrientMaster.js` (26 codes), `nutrientCatalog.js` (52 display keys) | **Tables empty locally** — pipeline built, never run (populate script exists) |
| Aliases/regional names | EXISTS | `IngredientCatalog.aliases`, `data/imports/ingredient-aliases.json`, `nutrients/matching.js` synonym map (Indian↔English), `foodIntel.js` ALIASES | Indian staples covered (dal variants, ragi/jowar/bajra, paneer, ghee) |
| NULL≠zero discipline | EXISTS | `nutrientStatus.js` coverage states; `mealNutrition.js` fiberKnown/fiberComplete; `conditionEvaluation` INSUFFICIENT_DATA; `scoringV2` no_data | Verified in tests; `Recipe.fiberG @default(0)` is a schema counter-example (defaults to 0, not null) |
| Recipe model + yield/retention | PARTIAL | `Recipe` (:269, `finishedYieldG`, `portionG`, `nutritionSource.retention`), `aggregateRecipe` (foodIntelligence.js:88-109) | Retention requires `reviewed:true` + factors + source — correct gate, **zero data**. 141/371 recipes have no yield; stored per-serving totals are estimates |
| Verified-label vs estimate separation | EXISTS | `verificationLevel` (catalog), `dataQuality` labels (`VERIFIED_DATABASE`/`USER_REVIEWED_LABEL`/`UNREVIEWED_OCR`/`*_RECIPE_CALCULATION`) in foodIntelligence.js | Consistent vocabulary, enforced |
| Barcode scans ≠ verified | EXISTS | `BarcodeProduct.source`, `verified: source==='catalog'`, OFF fallback marked `dataQuality:'community'` | Correct |
| Indian cooking (tadka, katori, oil retained) | PARTIAL | servings table (estimated), education notes | No oil-used-vs-retained modeling; no household measure → grams conversion table beyond `IngredientServing` estimates |
| Data-quality validation | PARTIAL | `ingredientCsv.validate`, import reports (`IngredientImport.report`), `nutrients/population.js` coverage() | No standing validation script for DB invariants (dupes, impossible values, macro-energy reconciliation); junk found — see DATA_QUALITY.md |

## Phase 3 — user context, consent, goals

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Health profile/conditions/allergies | EXISTS | `UserHealthProfile` (:62), `UserHealthCondition` (:94), `UserAllergy` (:118); 49 users w/ conditions, 115 w/ allergies locally | `UserHealthProfile` has **0 rows** — profile data actually lives on `User` (goalType, activityLevel, height, weight, DOB, gender) |
| Goals/targets | EXISTS | `User.goalType`, `MacroGoal` (:1317, 52 rows), `GoalHistory` (:3856 — new, unused), `calorieEngine` Mifflin-St Jeor + GOAL_ADJUSTMENT | 1844/1845 local users have `goalType=null` (seed accounts); targets often fall back to generic values |
| Preferences/restrictions | EXISTS | `UserPlanningPreferences.dietaryRestrictions` (:1418, incl. jain/halal/kosher animal-additive handling), `FoodPreference` LIKE/DISLIKE/NEVER_RECOMMEND (:1439) | Good coverage incl. eggetarian handling |
| Life stage (pregnancy/lactation/minor) | MISSING as data | `decisionEngine.LIFE_STAGE_BLOCKS` (:8) enumerates them, **but nothing populates life-stage facts** — no pregnancy field, DOB exists | Resolver exists; no source of truth feeds it |
| Medication disclosure | MISSING | — | No `medication` model; SupplementRule covers supplement-timing only |
| Eating-disorder / RED-S screening | MISSING as data | `MEDICAL_TRIGGERS` includes `eating_disorder_risk` (:9) | No screening input or pathway |
| Consent for nutrition guidance | PARTIAL | `TrainerClientConsent` (:2206), `ConsentSharingScreen`, mind-module consent booleans | Consent exists for coach sharing + AI journal — not scoped to nutrition-analysis/education display |
| User-confirmed vs inferred medical info | PARTIAL | User-entered conditions/allergies only — nothing infers conditions from logs (good) | No `source`/`confirmed` field distinguishing self-reported vs clinician-provided |

## Phase 4 — deterministic multi-layer pipeline

| Stage | Status | Where | Notes |
|---|---|---|---|
| 0. Normalize + provenance | PARTIAL | `foodSearch.js`, `ingredientService` 3-tier (user→central→USDA), `mealNutrition` line resolution, `nutritionSnapshot` on FoodLog/RecipeIngredient | No unified "food input → normalized entry w/ source+uncertainty" front-door shared by all paths |
| 1. Safety gates | EXISTS | allergy hard-exclusion (`mealSuggestion.js:134-166`, `foodIntel.checkSuitability`), `conditionRule` blocks (legacy target='ingredient' + clinical `clinical_ingredient`), `decisionEngine` red-flags, `safetyPipeline` | Multiple parallel implementations — mealSuggestion, foodIntel suitability, safetyPipeline, conditionEvaluation — **not one gate**; all fail-closed though |
| 1.5 Context + logging confidence | PARTIAL | `nutrientStatus` completeness (`partial-window`/`full-window`), `energy.intake.completeness` | No explicit logging-confidence score feeding decisions; decisionEngine takes `missingInputs`/`dataConfidence` params but callers don't compute them |
| 2. Goal evaluation | PARTIAL | `calorieEngine` (BMR/TDEE/goal delta), `energySummary` target (`intakeKcal`), `recommendFromBalance` pacing | Single-goal; no multi-objective conflict resolution or hard/soft constraint split |
| 3. Portion intelligence | PARTIAL | `OCCASION_TARGET_SHARE` meal sizing, `PortionAdjustScreen` (mobile), serving estimates | No satiety/meal-completeness features |
| 4. Dietary-pattern trends | PARTIAL | `weekly/` services (adherenceEngine, deficiencyDetector, weeklyReviewGenerator), `WeeklyHealthReview`, `DailyScoreSnapshot` trend | Check coverage-aware windows — EWMA/“4 of 7” heuristics not implemented as specified |
| 5. Explanation payload | MISSING | — | `reasons[]`/`why[]` strings exist per-service; no typed JSON with claim IDs/evidence refs for scoring/suggestion output (foodIntelligence findings DO have evidence refs — closest model) |
| 6. LLM phrasing-only | PARTIAL | `aiProvider.askJSON` — strict JSON schema, quota, kill switch, `nutritionRecommendation` re-rank (IDs-only payload, validated) | Good containment where used; `mealAnalyzer`/photo paths give AI more latitude (food identification, not nutrients — acceptable); no output-claims validator layer |
| Escalation/resolver | EXISTS | `decisionEngine.resolve` → ESCALATION/REVIEW/ASK/FEEDBACK | Wired only into `reminders/scheduler.js`; not a front-door for nutrition flows |
| Scoring | EXISTS | `scoringV2.dailyScore` (dps-v2), `dailyProgress.computeDay` (weights v2), legacy `healthScoreEngine` | **Three parallel systems** + `DailyMacroScore`/`macroScoreService` — needs consolidation decision (D2) |

## Phase 5 — ingredient & pattern taxonomy

| Requirement | Status | Notes |
|---|---|---|
| Added vs total sugar | PARTIAL | `SUGAR_ADDED`/`SUGAR_TOTAL` distinct codes; scoringV2 uses addedSugar ref 50g; fruit-sugar penalty removed in v2 (v1 still penalizes "high sugar" generically — UNSAFE) |
| Whole fruit vs juice, refined vs whole grain, sodium sources, fats taxonomy | MISSING as rules | `IngredientAttribute` exists (67 rows) but taxonomy rules as data aren't seeded; education file covers jaggery/dried fruit/nuts only |
| "Do not punish insulin spikes/seed oils/gluten/dairy as inflammatory" | EXISTS (by absence) | No such rules exist anywhere — compliant by omission |
| Population/goal/rationale/counterexample per rule | PARTIAL | Schema supports applicabilityCriteria + rationale; no counterexample field |

## Phase 6 — education & substitutions

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Post-log education | PARTIAL | `data/foodEducation.json` (57 lines: jaggery, dried fruit, nuts…), `educationFor()` attaches to suggestions | Not wired into post-log flow on mobile — check `FoodEntryScreen`/`mealSync` |
| Substitution engine | PARTIAL | `POST /food-intel/alternatives` (`svc.alternatives`) | Deterministic? verify re-run safety checks on substitutes — UNVERIFIED depth |
| "Based on meals logged" language | EXISTS | `nutrientStatus` disclaimers, meal-suggest `intakeCompleteness`, `recommendationEngine` honest copy | Good compliance |
| Localization | MISSING | English only; aliases cover search terms not UI copy | Hindi/Telugu/Tamil roadmap per prompt |
| No food shaming/streak pressure | EXISTS | `recommendationEngine` copy is non-judgmental; `UserStreakPreferences.pausedUntil` (no-guilt mechanics) | Aligned |

## Phase 7 — test & evaluation

| Requirement | Status | Notes |
|---|---|---|
| Unit tests | EXISTS | 106 backend test files incl. scoringV2(25), nutritionStatus, conditionRules, nutrientImport, nutrientPopulation, foodIntel, labelInsights, mealSuggest, estimate, ingredientV5, macroScore, healthScore |
| Golden fixtures for Indian foods | MISSING | `tests/fixtures/` exists; no raw/cooked rice, roti, dal tadka, paneer butter masala fixtures found — scenario registry has IDs but no fixture bodies |
| Scenario registry | PARTIAL | `data/scenarioRegistry.json` 120 scenarios (12 cats × 10), `scripts/seed-scenarios.js`, `ScenarioDefinition` model — all `pending_review`; no executable fixtures per scenario |
| Adversarial tests (injection, forged sources, units, zero-vs-null) | PARTIAL | conditionEvaluation tests cover invalid criteria/evidence; aiSchemas.review.test.js covers schema; no prompt-injection-via-barcode suite |
| Flag-off regression | PARTIAL | featureFlags tests exist; no explicit "v2 off → v1 byte-identical" suite |
| Zero-unresolved-critical gate | N/A | nothing rolled out yet |

## Phase 8 — release & monitoring

| Requirement | Status | Where | Notes |
|---|---|---|---|
| Server-side flags | EXISTS | `config/featureRegistry.js` (60+ flags), `featureFlags/service.js` precedence, `requireFeature` middleware, mobile `gateScreen` | v2 flags default false, failOpen:false. PostHog + env + kill switch |
| Kill switch | EXISTS | `AI_EMERGENCY_SHUTDOWN` env + `ai_emergency_shutdown` flag → all group:'ai' flags off | Verified logic |
| Additive migrations | EXISTS | Migration history is additive (per docs); local DB is 10 behind — see STATUS B2/B7 | AGENTS.md drift warning honored |
| Staged enablement / cohorts | PARTIAL | PostHog targeting exists (project 701405); no test-cohort model in DB; founder/admin allowlist = role system | Needs a canary cohort definition |
| Telemetry for ungrounded claims/data gaps | MISSING | `ApiUsage` exists for AI calls; no claim-validation telemetry | |
| Rollback | PARTIAL | Flags give instant rollback; score snapshots keep `version`/`scoreVersion` | Model-level rollback for rule/content via status lifecycle |

## Cross-cutting honest gaps

1. **Consolidation**: 3 recommendation paths (`recommendationEngine`, `mealSuggestion`, `nutritionRecommendation.suggestMeals`) + 3 scorers (v1, dailyProgress v2, dps-v2) + parallel safety gates — the master prompt wants ONE pipeline. Decide the front-door (D2).
2. **Explanation contract**: foodIntelligence findings carry rule/evidence/version — adopt that shape as the universal "explanation payload" (Phase 4.5) rather than inventing a new one.
3. **No universal hard floors today** — `calorieFloor` exists in scoringV2 but the route passes null (B3); decision D4 needed (phase0 G4 still open).
4. **Local env can't run v2 end-to-end** until migrations applied (B2) — this is also why score-v2's B1 crash wasn't caught by manual testing.
