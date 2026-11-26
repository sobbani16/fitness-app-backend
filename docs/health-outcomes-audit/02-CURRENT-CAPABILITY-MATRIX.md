# 02 — Current Capability Matrix

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
Trace standard: Mobile UI → API → Auth → Validation → Service → Rules → DB → Response → Render.
Status legend: **WORKS** (end-to-end real-user path), **PARTIAL** (works with caveats), **FIXTURE-ONLY** (only reachable via test-fixture paths), **DEAD** (code exists, unreachable), **MISSING** (no implementation), **GATED** (behind flag, off by default).

| # | Capability | Status | Evidence (trace) |
|---|---|---|---|
| 1 | Food logging (manual) | WORKS | `POST /food-logs` → authenticate → validateInput → FoodLog rows (323 in dev DB); mobile LogMealScreen; flag `manual_food_logging` fail-open |
| 2 | Ingredient search + USDA lookup | WORKS | `/ingredients` routes → ingredientService/usdaService; 426 ingredients, 186 w/ fdcId |
| 3 | Meal nutrition compute | WORKS | `computeMealNutrition` — per-100g math, `unresolved[]` reported, fiber unknown tracked (`nutrientCompleteness`) |
| 4 | Calorie targets (BMR/TDEE/goal) | WORKS | `calorieEngine` Mifflin–St Jeor + activity factors; `recalcDefaultGoal` on profile save; goal-history versioning |
| 5 | Calorie safety floor | PARTIAL | `calorieSafety.js` policy exists (supervised-condition gates, BMI<18.5 weight-loss block) but header says "PROPOSAL, INACTIVE — not wired into any route" |
| 6 | Allergy management | WORKS | `PUT /me/allergies` canonical keys + custom; immediate weekly-plan revalidation; allergen keyword expansion in constraints/mealSuggestion |
| 7 | **Health-condition recording** | **MISSING** | No write path: only `routes/safetyFixtures.js` creates `UserHealthCondition` (env `SAFETY_STATE_FIXTURE`, never in prod). No mobile screen. → all condition-aware features are FIXTURE-ONLY |
| 8 | Condition-aware ingredient filtering | FIXTURE-ONLY | `ingredientValidator`, `recipes/constraints.js`, `weeklyDietGenerator` all read `userHealthCondition` + APPROVED `ConditionRule` — correct code, unreachable inputs (0 real user rows; 0 APPROVED rules) |
| 9 | Condition-aware nutrient rules | FIXTURE-ONLY | `conditionEvaluation.evaluateForConditions` — only APPROVED rules fire; DB has 14 DRAFT nutrient rules → always `conditionsWithoutApprovedFindings` |
| 10 | Recipe catalog | PARTIAL | 258 recipes (28 SYSTEM + 230 RESEARCH_DRAFT). SYSTEM stored kcal/protein disagree w/ ingredient math >20% on 15/28 (see 04). DRAFTs internally consistent |
| 11 | Recipe generate/customize | PARTIAL | `recipes/constraints.js` is solid (server-authoritative, narrowing-only); generate path exists — but condition rules inert + sodium/sugar not modeled |
| 12 | Weekly meal plans | GATED/PARTIAL | `weeklyDietGenerator` merges allergies + APPROVED rules + MacroGoal; AI path flag-gated (`ai_weekly_generator`) |
| 13 | Supplements catalog + dose tracking | WORKS | 207 supplements, schedules + dose occurrences idempotent (dedupe-keyed) |
| 14 | Supplement-condition interactions | PARTIAL | `safetyEngine` requires approved+PUBLISHED interaction rules — 47 rules all `approved=false` → only attribute/allergen flags + explicit "checks not yet active" disclosure (honest degradation). NOTE: line 80 compares `reviewStatus === 'PUBLISHED'` — enum only has DRAFT/REVIEWED/APPROVED → `approved` never true (dead branch, fails safe) |
| 15 | Activity safety engine | PARTIAL | Engine + 71 rules all DRAFT → medical dimension inert; BUT structural mechanics always-on: injuries/surgeries/restrictions/symptoms DO work (real write paths: `/activity-safety` routes + voice) |
| 16 | Symptom/injury/surgery tracking | WORKS | `POST /activity-safety/symptoms|injuries` + voice intake; UserInjury/UserSurgery/UserSymptomReport real rows possible |
| 17 | Exercise library | WORKS | 884 exercises, 3,735 muscle mappings, 0 unmapped. **Cardio only 14 (1.6%)** — aerobic training severely underrepresented for a health-outcomes product |
| 18 | Exercise suitability | WORKS (rules) | `exerciseSuitability.classify` — limitations/equipment/experience; 'review' never claims safe/unsafe |
| 19 | AI workout draft | GATED | `workoutPlanner` — catalog-whitelist, clamp sets 1–6/rest 30–300s, server-derived limitations unioned; flag `ai_workout_recommendations` |
| 20 | Pose coaching | WORKS (device) | On-device engine w/ 16-state status machine; backend stores landmark analytics only w/ consentToStore; `suspend` priority class exists |
| 21 | Wearable sync (energy/steps/sleep) | WORKS | `/health-data/*` behind `apple_health_sync`/`android_health_sync` flags; HealthMeasurement + cursors; synthetic flag for simulators |
| 22 | Lab measurement ingest | **MISSING** | No HbA1c/lipids/BP/waist/eGFR/uric-acid model or API |
| 23 | Health score | WORKS | `healthScoreEngine` + ScoreContributor + policy version |
| 24 | Outcome plans (trainer) | WORKS | OutcomePlan/OutcomeGoal w/ version supersede + adjustment log — trainer-scoped only; no consumer outcome journey |
| 25 | Trainer access boundaries | WORKS | TrainerClient + TrainerClientConsent (464 rows) + consent sharing screen + view-as read-only |
| 26 | AI coach (Leo) | GATED | `/chat` behind `ai_coach`; AI kill-switch; 20 calls/50k tokens/day user quota |
| 27 | Medication tracking | **MISSING** | No model; only `medicationActivityFlags` coarse JSON (hypoglycemia_risk etc.) on activity profile |
| 28 | Multi-condition conflict resolution | **MISSING** | `conditionEvaluation` detects rule conflicts → PERSONALIZATION_REQUIRED but no cross-condition resolver; gap-analysis doc already flags `conflicting_conditions` absent |
| 29 | Reminders | WORKS | reminderPlan engine, merge-exempt supplement-dose notifications |
| 30 | Account deletion/export | WORKS | `accountData.deleteAccount` — full owned-model purge + anonymized purchase refs + 35-day receipt |
| 31 | Feature flags | WORKS | Registry 874 lines; server-side requireFeature; env allowlists; AI kill group; PostHog + fail-safe defaults |
| 32 | Clinical rule governance | PARTIAL | Model complete (RuleEvidence, reviewStatus DRAFT→REVIEWED→APPROVED, DB CHECK requires reviewer+evidence); admin review routes exist; **zero APPROVED rows** |
| 33 | Mind/wellness (depression/anxiety-adjacent) | PARTIAL | MindExercise + wellness check-ins exist — no validated instruments (PHQ-9/GAD-7/ISI/PSQI) |

## Reachability verdict

The single most consequential gap: **the condition-aware nutrition/safety system is architecturally sound and correctly conservative, but has no production input path** (no condition recording API/UI) **and no approved rules** — it is a well-built engine with no fuel. Allergies are the only fully-working safety dimension today.
