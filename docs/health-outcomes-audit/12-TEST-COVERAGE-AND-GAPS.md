# 12 — Test Coverage & Gaps

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Executed:** 2026-11-22 (this audit)

## 1. Executed results (real, not claimed)

| Suite | Command | Result |
|---|---|---|
| Backend jest | `npx jest --runInBand` (backend@b75044a) | **154/156 suites PASS · 5,957 tests pass · 4 skipped · 48 todo · 0 failures** · 21.5s · isolated TEST_DATABASE_URL |
| Mobile jest | `npx jest` (mobile@5cc1831) | **93/93 suites PASS · 673 tests pass** · 5.7s |
| Mobile typecheck | `npx tsc --noEmit` | **PASS — 0 errors** |
| Backend lint | not run this session (no eslint script in package.json) | n/a |

## 2. Coverage strengths (verified by file presence + pass)

- **Activity safety:** 16 dedicated suites (engine, e2e, envMatrix, notificationSafety, privacy, producers, reachability, reviewPackage, routes, scenarioMatrix, scenarios, shadowDiff, todayActions, voice, clearancePrecedence) — the deepest test investment.
- Nutrition: calorieEngine, calorieSafety, conditionRules, nutrientCompleteness (via foodLoggingRegression), recipeRank/Cache/Import paths, mealNutrition.
- Trainer platform: e2eTrainerJourney, coachingTransaction, trainerNutrition, copilot, partnership.
- Governance: clinicalRuleWorkflow, medicalFlagGovernance, conditionRules — the DRAFT→APPROVED workflow is tested.
- Mobile: screens, navigation, detection (repCounter, formRules, mockEngine, realEngine, posture, coords), services (reminderPlan, safetySuggestion, stepsSync), storage.

## 3. Coverage gaps (vs Phase 9 requirements)

| Required test | Exists? |
|---|---|
| Condition → recommendation integration (real user path) | **NO** — impossible: no condition write path exists to test |
| Multi-condition conflict resolution | NO (engine conflict detection tested; resolution absent) |
| Medication → contraindication | NO (no medication model) |
| Lab entry → progress display | NO (no lab model) |
| Outcome journey (baseline→90d) | Partial — outcomePlans tests cover trainer plans only |
| Adversarial: unsafe calorie targets | calorieSafety.test.js exists (proposal module) — but production path has no floor enforcement test |
| Adversarial: hypoglycemia risk | Partial — `hypoglycemia_risk` flag paths in activitySafety tests |
| Adversarial: prompt injection in food/clinical content | Partial — generate.js hygiene; dedicated injection suite not found |
| Missing lab units / contradictory labs | NO |
| Stale health information | Partial — activity rules handle env staleness; condition-staleness none |
| Regression: account deletion covers new tables | accountLifecycle tests exist; must extend when new PHI tables land (F-S2) |

## 4. Tests that must be added for health-outcomes scope

1. `conditions.write.test.js` — CRUD + consent + audit for the (to-be-built) condition API.
2. `conditions.conflicts.test.js` — matrix of the 10 spec combinations → single resolved plan + explainability payload.
3. `labs.ingest.test.js` — units, provenance, contradiction handling, missing-unit rejection.
4. `outcomes.interpretation.test.js` — MCID vs noise, no-remission-claim enforcement, provenance labeling.
5. `safety.floor.e2e.test.js` — wired calorie floor once approved (currently proposal).
6. `fixtures.exclusion.test.js` — assert test-fixture rows never surface in catalog/search (F-N5 regression).
7. `deletion.coverage.test.js` — every new PHI table covered by deleteAccount (F-S2 regression).
