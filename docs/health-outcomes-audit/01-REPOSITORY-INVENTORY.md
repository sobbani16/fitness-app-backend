# 01 — Repository Inventory

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22
**Date:** 2026-11-22

## Repos

| Repo | Commit | Stack | Size |
|---|---|---|---|
| fitness-app-backend | `b75044a` | Node 20, Express, Prisma 6, Postgres 15, Jest | ~100 route files, ~150 services, 204 Prisma models, 156 test suites |
| fitness-app-mobile | `5cc1831` | React Native 0.x (bare, iOS+Android), TypeScript, Jest | ~78 screens, ~50 API modules, detection/pose engine, ml/ |

## Backend module map (src/)

| Area | Key files | Purpose |
|---|---|---|
| Auth/account | `services/authService.js`, `authLifecycle.js`, `oidc.js`, `middleware/authenticate.js`, `services/accountData.js` | Session auth (Bearer → req.userId rewrite), OIDC, account export/delete with receipt, view-as (super-admin read-only) |
| Nutrition core | `services/mealNutrition.js`, `nutrientCompleteness.js`, `calorieEngine.js`, `calorieSafety.js`, `nutrition.js`, `scoringV2.js`, `macroScoreService.js` | Per-100g math, explicit unknown tracking, Mifflin–St Jeor BMR/TDEE, calorie floor policy (proposed, unwired) |
| Ingredient pipeline | `services/ingredientCatalog.js`, `ingredientCsv.js`, `ingredientImportV5.js`, `usdaService.js`, `nutrientImport.js`, `nutrients/` | Catalog v5 import w/ verification labels, USDA FDC fetch, nutrient profiles w/ provenance |
| Recipes | `services/recipes/` (constraints/generate/validate/cache/metrics), `recipeService.js`, `recipeImport.js`, `recipeMatch.js` | Normalized user-constraint engine; generate+validate; import w/ review status |
| Meal planning | `services/weekly/` (weeklyDietGenerator, planningPolicy, centralRecipes, calorieAdjustmentEngine, aiWeeklyGenerator, deficiencyDetector, mealSwapService), `services/mealSuggestion.js`, `nutritionRecommendation.js`, `safety/mealRecommendationService.js` | Deterministic weekly plans + AI draft path; allergies+APPROVED rules only |
| Safety | `services/safety/` (safetyPipeline, ingredientValidator, nutritionValidator, supplementValidator, contextBuilder, mealRecommendationService, coachingService) | Legacy validation pipeline — logs to SafetyAuditLog |
| Clinical nutrients | `services/nutrients/conditionEvaluation.js`, `conditionRuleImport.js`, `matching.js`, `population.js`, `foodIntelligence.js` | APPROVED-rule evaluator w/ clinician-limit support + applicability criteria |
| Activity safety | `services/activitySafety/` (engine, context, environment, gate, rulesData, activityCatalog, observe, recommendationSafety) | Deterministic 4-dimension engine (medical/functional/environmental/personalization), 71 DRAFT rules, evaluations persisted w/ policyVersion |
| Exercise | `services/exerciseCatalog.js`, `exerciseDbService.js`, `exerciseService.js`, `exerciseSuitability.js`, `workoutPlanner.js`, `workoutProgression.js`, `muscles.js` | 884-exercise library, suitability classifier, AI draft planner w/ catalog whitelist |
| Pose coaching | `services/poseCoaching.js`, `routes/poseCoaching.js`, mobile `src/detection/` | Consent-gated analytics-only sessions; on-device model status machine |
| Health data | `routes/healthData.js`, `services/healthData.js`, `healthSources.js`, models HealthMeasurement/HealthSyncCursor/WearableDevice/HealthEnergyRecord | Wearable ingest (energy/steps/sleep), source cursors, dedupe upserts |
| Supplements | `services/supplements/` (safetyEngine, schedules, timingGuidance, researchImport), `supplementService.js` | 207-item catalog, interaction rules (approved+published only), dose occurrences |
| Fiber | `services/fiber/` (dailyEngine, weeklyReview, supplementCheck) | Fiber targets/tracking feature, flag `fiberIntelligence` |
| Trainer platform | `services/trainer*`, `routes/trainer*`, `services/outcomePlans.js`, `BaselineAssessment` | Trainer profiles, client consent, nutrition/workout plans, outcome plans, commerce, messaging, copilot |
| Feature flags | `services/featureFlags/` + `config/featureRegistry.js` | PostHog provider + env override + allowlists + AI kill-switch + server-side `requireFeature` middleware |
| AI | `services/aiProvider.js`, `aiService.js`, `aiSchemas` (tests), `weekly/aiWeeklyGenerator.js` | OpenAI JSON-mode calls; quotas; kill-switch; strict schemas; non-AI fallbacks |
| Misc engines | `services/decisionEngine.js`, `recommendationEngine.js`, `healthScoreEngine.js`, `todayActions.js`, `progressCoach.js`, `unifiedProgress.js` | Scores, daily actions, progress aggregation |

## Mobile module map (src/)

| Area | Contents |
|---|---|
| `screens/` | 78 screens; health-relevant: InjuriesScreen, SymptomHistoryScreen, SafetyReportScreen, SafetyFeedbackScreen, HealthScoreDetailScreen, ConnectedHealthScreen, HealthSourcesScreen, OutcomePlanScreen, IntakeScreen, FoodIntelligenceScreen, MySupplements + Schedule, PoseCameraScreen, MuscleExplorerScreen |
| `navigation/RootNavigator.tsx` | `gateScreen(featureKey, Screen)` wrappers for ~60 gated screens |
| `src/detection/` | Pose engine: `engineStatus.ts` state machine (uninitialized→tracking + failure states incl. `low_confidence`, `incomplete_body`, `model_init_failed`), `formRules.ts` (min-visibility evidence thresholds), `repCounter.ts`, `realEngine.ts`/`mockEngine.ts` |
| `src/api/` | 50 typed API modules mirroring backend routes |
| `src/services/` | reminderPlan, reminderSync, notifications, safetySuggestion, storage, analytics |

## Notable absences (verified by grep over src/ + schema.prisma)

| Expected capability | Status |
|---|---|
| `UserHealthCondition` write path (user-facing) | **MISSING** — only `routes/safetyFixtures.js` (env-gated test fixture) writes rows |
| Medication model (`Medication`/`UserMedication` table) | **MISSING** — only coarse `medicationActivityFlags` JSON on UserActivityProfile |
| Lab measurement ingest (HbA1c, lipids, BP, waist, eGFR) | **MISSING** — HealthMeasurement only covers wearable metrics (hr, steps, sleep, energy, workout); WeightEntry is manual |
| Exercise contraindication metadata on Exercise model | **MISSING** — handled via activitySafety rule registry instead |
| Health-condition management UI (mobile) | **MISSING** — no screen lists/selects conditions |

## Prior audit assets already in repo (reused, not redone)

- `docs/nutrition-intelligence/` — 75+ docs incl. CONDITION_FEATURE_GAP_ANALYSIS, CLINICAL_GOVERNANCE_IMPLEMENTATION, CLINICAL_RULE_APPROVAL_MATRIX
- `docs/recipe-intelligence/` — database-quality-report, ingredient-data-audit, constraint-taxonomy, scenario-registry
- `docs/audits/activity-safety-*` — 25+ phase reports incl. rule-by-rule validation, claims inventory, security-privacy
- `docs/clinical/` — review workflow, adjudication queue, evidence register
- `docs/food-logging/`, `docs/fiber-intelligence/` — release audits
- `FEATURE_FLAG_REGISTRY.md`, `SECRETS_MANAGEMENT_AUDIT.md`
