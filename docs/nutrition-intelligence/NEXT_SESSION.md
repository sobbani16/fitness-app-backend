# NEXT_SESSION — resume state

**Checkpoint:** 2026-11-21, end of remediation phase.

## Resumable immediately

0. **Scenario spec found (2026-11-21)** — original Appendix A was outside the repos (`~/Downloads/Humai_Fitness_Devin_Master_Prompt.md:199–653`). Now preserved verbatim: `docs/nutrition-intelligence/APPENDIX_A.md` + `data/scenarioAppendixA.json`; registry enriched with `scenario` + `expectedVerbatim`; DB `data` blob synced. Full forensic record: `SCENARIO_SOURCE_AUDIT.md`. This resolves HR-001 within repo scope.
1. **Scenario fixture program** — `SCENARIO_VALIDATION_MATRIX.md` + `var/scenario-matrix.json` list the 108 `pending_specification` scenarios. Each needs a reviewer-authored fixture (inputs + measurable expectation) asserting against `expectedVerbatim`. Regenerate matrix after adding tests: `node scripts/scenario-matrix.js`.
2. **Ingredient dedupe (D12)** — 12 normalizedName dup groups + `peanut`/`Peanuts` plural near-dup; `INGREDIENT_VERIFICATION_BACKLOG.md` ranks 466 unverified rows by real usage (145 fdcId-proxies are quick wins via the population importer).
3. **Test-user deletion** — `TEST_USER_CLEANUP_IMPACT.md` procedure; blocked until fixture isolation fix (tests keep generating users) + full-schema FK sweep + backup.
4. **Clinical review** — `CLINICAL_RULE_REVIEW_QUEUE.md` (14 nutrient rules need thresholds; 31 legacy DRAFTs need evidence or archival). No approval path exists yet in tooling — needs reviewer role + admin UI or scripted approve-with-evidence.
5. **G4 calorie policy** — `CALORIE_SAFETY_POLICY_PROPOSAL.md`; after clinical sign-off, wire `evaluateCalorieSafety` output to `calorieFloor` in `dailyProgress.js` (hook present).
6. **PIPELINE consolidation** — `PIPELINE.md` spec exists; 3 recommenders + 3 scorers still coexist. D11: pick canonical score (v2) once acceptance criteria in `HEALTH_SCORE_V1_V2_COMPARISON.md` are met.

## Regenerating artifacts

`node scripts/scenario-matrix.js` · `node scripts/ingredient-verification-backlog.js` · `node scripts/test-user-impact.js` · `node scripts/audit-junk-data.js` (dry-run; `--apply` guarded) · `node scripts/verify-rule-gating.js`

## Verification commands

`npx jest tests/<file>.test.js --runInBand` · `npx prisma validate` · `npx prisma migrate status`

## Known open items (do not re-discover)

- `mealSuggest.test.js` leaves `RuleEvidence` rows behind (~21 accumulated) — add to its fixture cleanup.
- `featureFlagOverride` prisma accessor name differs from the model name used in `test-user-impact.js` — fix before relying on that edge count.
- Scenario registry `reviewStatus: pending_review` is global, not per-scenario.

## 2026-11-21 validation checkpoint

- D1 done: canonical goals (weight_loss, fat_loss, muscle_gain, weight_gain, bulking, maintenance, body_recomposition) + aliases; `normalizeGoal`→null on unknown; profile stores canonical; energySummary flags `unrecognized_goal`.
- D2 done: `expected` deprecated; `expectedVerbatim` authoritative.
- D3 state: `data/scenarioFixtures.json` (120 fixtures) + `tests/scenarioFixtures.test.js` → 52 pass / 1 fail (A06=HF-0020, keep red) / 67 blocked_not_implemented. Regenerate: `node scripts/build-scenario-fixtures.js`; matrix: `node scripts/scenario-matrix.js`.
- Next: fix A06 energy-in-earned gap; author missing capabilities (H08/G06/G10 triggers, allergen-warning outcome, goal switching); then clinical review of all 120 asserts.

## 2026-11-21 medical-launch + P0 checkpoint

- HF-0020 FIXED: `scoringV2` → `dps-v2.1` (energy earns 10, carbs/fat ±20% ranges at cap 6, protein 12/fiber 6 adequacy). A06 passes.
- decisionEngine: `safety_warning` outcome + 3 persistent-symptom triggers. I07/I08/H08/G06/G10 now executable+pass.
- Fixtures: **56 pass / 0 fail / 64 blocked**; P0: 40/50 executed all-pass. Remaining blocked P0: F05 F08 F09 J01 K04 K05 K08 K09 L02 L10.
- Docs written: MEDICAL_LAUNCH_SCOPE, US_INDIA_REGULATORY_REVIEW, CLINICAL_RULE_APPROVAL_MATRIX, CONDITION_FEATURE_GAP_ANALYSIS, MEDICAL_VALIDATION_TEST_PLAN, HEALTH_DATA_PRIVACY_AUDIT, CLINICAL_RELEASE_GATES, MEDICAL_LAUNCH_ROADMAP, P0_REMEDIATION_REPORT, TEST_ISOLATION_REPORT, CLINICAL_REVIEW_QUEUE.
- Next eng work (safe, no activation): blocked-capability builds per MEDICAL_LAUNCH_ROADMAP #4–#9; photoScan/exerciseLibrary isolation fix per TEST_ISOLATION_REPORT.

## 2026-11-21 P0 closure checkpoint

- **50/50 P0 executed PASS** (68/120 total; 52 blocked P1/P2). New: `src/services/scenarioCapabilities.js`, `mobilityLimited` in scoringV2.
- Test isolation fixed: matcher orderBy + photoScan scoped cleanup → full suite **1,323 pass / 0 fail**.
- Founder testing: `health_score_v2` + `scenario_engine` eligible per FOUNDER_TESTING_PLAN; proposed flags (allergen_warnings, calorie_floor_policy, condition_rules, supplement_safety, medication_interaction) must be created default-OFF.
- Next: capability builds for 52 blocked (trend/outcome monitors, micro breadth, meal-timing, digestive triage, condition-personalization content — all clinical-review-dependent), consent/privacy work, clinician + counsel engagement.

## 2026-11-21 governance checkpoint

- **5 medical flags live in registry** (OFF/fail-closed, `group:'medical'`): allergen_warnings, calorie_floor_policy, condition_rules, supplement_safety, medication_interaction. `tests/setup.js` no longer auto-enables `medical` group — explicit per-test only.
- **Integration audit**: capability functions exist + pass; NONE wired to consumers (`NUTRITION_ENGINE_INTEGRATION_STATUS.md`). Wired engines: dailyScore (flagged route), decisionEngine (reminders), healthScoreEngine (live).
- **Suite: 119/1,458/0-fail.** Roadmap for the 52 blocked: `REMAINING_SCENARIO_ROADMAP.md` (Sprint A trend layer first).
- Next: Sprint A trend layer → wire scenarioCapabilities to consumers → reviewer engagement (specialty queues ready).

## 2026-11-21 Sprint A checkpoint — trends + capability integration

- `src/services/trends.js` (trends-v1) wired into `/me/progress/unified`: 7/14/30d coverage-aware trends; missing≠zero; smoothed weight "not fat loss"; GoalHistory surfaced; observational.
- 6 capabilities wired to production consumers (see CAPABILITY_INTEGRATION_REPORT): goal→GoalHistory, food-log dup advisory, wearable workout dup flag, wearable-kcal plausibility cap (2.5×BMR engineering bound), recipe servings rescale, raw/cooked state-conversion (factor-gated).
- Tests: trends 6 + capabilityIntegration 5 — green; all touched suites green.
- **Blocker NOT mine:** 18 activity-safety failures from uncommitted engine WIP (constants/engine/rulesData/activityCatalog edits) — S055 expects ALLOW etc. Resolve by updating expectations or reverting; unrelated to Sprint A.
- Next sprint (B): symptom/context association layer; trends feeding divergence monitor (detectOutcomeDivergence consumer); micronutrient breadth.
