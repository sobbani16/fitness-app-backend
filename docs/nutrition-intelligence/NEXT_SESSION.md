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

## 2026-11-21 Sprint B checkpoint

- symctx-v1 (`symptomContext.js`) → trends → `/me/progress/unified`: temporal meal↔symptom associations, non-causal language, persistent→review escalation. Reuses UserSymptomReport/FoodLog/WorkoutSession/SleepLog.
- `detectOutcomeDivergence` wired: DailyScoreSnapshot composites vs goalProgress → `reviews[]`. Goal-aware `observations[]` (kcal/protein/fiber vs target) added to trends.
- Wearable energy: implausible readings capped at 2.5×BMR + labeled (WEARABLE_ENERGY_VALIDATION.md).
- Suite 130/1622/0-fail. Remaining: symptom-history UI screens, consumer-side workout dedupe, micronutrient breadth (Sprint D), clinical reviewer engagement.

## 2026-11-21 Sprint C checkpoint

- `ingredientImpact.js` (14-category taxonomy + portion budget + substitution policy) → wired into `POST /food-logs/intelligence` (`impact`,`substitutions` from verified profile nutrients; unknowns unverified; allergen terms server-loaded).
- `trends.js` `frequent_calorie_dense` pattern observation (≥3 logs + ≥15% share).
- Pending: symptom-history mobile UI, category→food mapping table, consumer-side workout dedupe, D-series micronutrient breadth.

## 2026-11-21 Sprint D checkpoint

- classifyFood (classify-v1) live: nutrient-band + name-hint ladder (VERIFIED→DERIVED→ESTIMATED→UNKNOWN); client categoryId trust removed; band-collision fix (nuts≠cooking_fat/legumes) verified.
- PATTERN_THRESHOLDS versioned constant replaces hardcoded 3/15.
- Micronutrient audit → report; no fabricated values; IFCT licensing open.
- Still pending: symptom-history mobile UI, category coverage expansion via ingredientCatalog fields, consumer-side workout dedupe.

## 2026-11-21 Sprint E checkpoint

- Phase 0: 18 "failures" = order-dependent suite flakiness (scenarioMatrix 3840/3840 standalone). Root fix = env/module isolation in polluting suites — test-infra, not engine.
- classify-v1.1: legume band fat≤2+pro≥10 (rye-bread collision), added_sugar hint, whole-wheat regex. Catalog audit: 420 ingredients / 18 verified profiles → UNKNOWN dominance is honest, coverage ceiling is data.
- Pending: mobile symptom screens + impact/substitution rendering; suite isolation debt; verified-profile expansion is the real classification unblock.

## 2026-11-21 Sprint F checkpoint

- Test-flake root cause: real shared dev DB in tests + literal-date fixtures (reviewPackage `2026-11-22` dies Nov 25). Fix = dedicated test DB + relative dates.
- Owner Phase 17 (clearance precedence/invalidation/insufficient-data gate) verified green.
- Still pending: verified-profile import (needs API key + licensing), mobile symptom + intelligence UI, recipe linkage resolution.
- Biggest single unlock remains verified-profile expansion (18→target priority list).

## 2026-11-21 Sprint G checkpoint

- Test-DB guard live in setup.js: TEST_DATABASE_URL swap + remote-host REFUSAL (verified) + unlabeled-local warning. Next: provision fitness_test DB, set TEST_DATABASE_URL, migrate deploy.
- reviewPackage literal date → relative (−24h) — Nov-25 time bomb defused.
- USDA import needs owner API key (api.data.gov) — documented in USDA_IMPORT_EXECUTION_REPORT.
- Still pending: mobile symptom + intelligence screens (dedicated mobile session).

## 2026-11-21 H1 COMPLETE

fitness_test provisioned + TEST_DATABASE_URL set + schema pushed. Full suite: 134/135, 5,491 tests, 0 failures — nondeterministic flakiness ELIMINATED (shared-dev-DB was the confirmed cause). Remaining: USDA key (owner), mobile UIs, recipe linkage, governance docs.

## continuation pointer
Master execution status table → MASTER_EXECUTION_STATUS.md. Top task: mobile screens (H4 symptom, H3 intelligence). Backend suite green on fitness_test.

## 2026-11-22 H3+H4 mobile delivered

- GET /activity-safety/symptoms (owner-scoped, gated) + SymptomHistoryScreen (list/delete/context/privacy) + SafetyReport entry point + 3 component tests + route test.
- FoodIntelligence.tsx renders impact/classification/substitutions — live wherever the review panel mounts (FoodEntryScreen manual + recipe intelligence).
- Remaining: symptom EDIT endpoint (none exists), USDA key (owner), H5 recipe linkage, H8 scenario revalidation.

## 2026-11-22 H5+H8 progress

- H5: 17 unlinked recipe lines → 0 safe auto-links (all ambiguous/missing); ~10 catalog items needed (tuna, cottage cheese, mixed veg…) — RECIPE_LINKAGE_REPORT.
- H8: +4 scenarios executed → **72/120 pass** (C03/C04/C07/L06 via ingredientImpact re-export). 48 blocked: ~16 need async DB-runner, ~32 need clinical/spec review.
- Residual flake: `dailyStats.route` intermittently fails only in full-suite (passes standalone) — shared-fixture collision within fitness_test, not dev-DB coupling. First isolated run was 0-fail; nondeterminism reduced, not eliminated.

## 2026-11-22 H9 documented

Governance verified: APPROVED-filtered consumers + flag activation gate + admin transition route. Gaps recorded (missing lifecycle enum states, no reviewer-role model, no history table) — CLINICAL_GOVERNANCE_IMPLEMENTATION.md.
Residual flake note: dailyStats.route is MOCKED (not DB) — full-suite flake candidate = midnight-boundary or mock-order; passes standalone.

## 2026-11-22 async runner + divergence fix

- tests/asyncScenarios.test.js: 10/10 — real fitness_test fixtures → trends/symptomContext. CRITICAL: dotenv was never loaded in setup.js → TEST_DATABASE_URL swap never happened before; fixed.
- REAL BUG FIXED: trends queried DailyScoreSnapshot.day (schema=date) — swallowed by q(), divergence silently dead. Now works.
- 16 scenarios carry async evidence but remain blocked pending reviewer-approved asserts (honest, not inflated).

## 2026-11-21+ async/checkpoint update

- **Test DB:** `fitness_test` isolated + seeded (seed-rbac, seed-modules). `execSync` children in jest need `{ env: { ...process.env } }` — fixed in `tests/academy.test.js`.
- **Full suite:** 135/136 suites, 5,509 tests, **0 failures**, 48 todo — cleanest run.
- **Async runner:** `tests/asyncScenarios.test.js` — 10/10 at real-DB service level (A08–A09, H01–H07, D02, E04, G04, L03–L05). Fixed real defect: `trends.js` queried `DailyScoreSnapshot.day` → schema field is `date`.
- **Scenarios:** 72/120 executed_pass via sync fixtures + async evidence paths.
- **Mobile:** `SymptomHistoryScreen` shipped (list/delete/non-causal patterns), ingredient intelligence renders `impact`/`classification`/`substitutions` in `FoodIntelligence.tsx`.
- **Next:** symptom edit endpoint (delete+re-add documented), API-level async verification, USDA import (owner key), H6 wearable audit, H10/H11 docs.

## Cycle update — symptom CRUD + authenticated runner + H6/H10/H11 docs

- **Symptom PATCH** added (`PATCH /activity-safety/symptoms/:id`) — owner-scoped, validated fields, immutable userId/reportedAt; route tests 22/22; mobile `updateSymptom` + inline edit UI in `SymptomHistoryScreen` (Segmented severity/course). Real defect fixed: `notes` field doesn't exist in schema — removed from GET select, PATCH, mobile types.
- **`tests/asyncScenarios.api.test.js`** — authenticated HTTP runner: 7/7 pass covering A08–A09, H01–H07, D02, E04, G04, L03–L05 via `/me/progress/unified` + `/activity-safety/*`; cross-user isolation + flag fail-closed verified. 10-service-test↔14-scenario mapping reconciled in AUTHENTICATED_SCENARIO_VALIDATION.md.
- **execSync env leak** fixed: both academy.test.js call sites pass `{ env: { ...process.env } }`. Other spawn sites audited — already correct.
- **Flag-restore fix:** activitySafety.routes.test.js now restores gated keys in afterAll (was leaking 'false' to later suites).
- **USDA key present** — dry-run fetch verified (10/10 fdcIds to file cache, 0 failures, no DB writes). Full import still needs owner authorization.
- **Skipped suite identified:** platformE2E requires `fitness_auth_readiness` DB — skips by design, not a gap.
- **Residual flake:** energySummary×2 + voice + chat failed once; order-dependent; flag-env leaks are the leading hypothesis; not reproduced; no assertions weakened — see DAILY_STATS_FLAKE_RESOLUTION.md.
- **Docs created:** WEARABLE_RELIABILITY_FINAL, US_INDIA_COMPLIANCE_HANDOFF, HEALTH_DATA_SECURITY_FINAL, AUTHENTICATED_SCENARIO_VALIDATION, SYMPTOM_CRUD_FINAL, TEST_SUITE_REPRODUCIBILITY.
- **Next:** self-sufficient flags in voice.test.js/energySummary.test.js; reproduce flake via shuffled suite order; USDA import (owner auth); recipe catalog items; mobile dataGaps rendering.

## Cycle update — flake closure + scenario evidence + USDA readiness

- **All 4 full-suite failures root-caused/fixed**: voice + chat were leak-dependent (never enabled own flags) → self-sufficient beforeAll; energySummary instrumented for status; activitySafety.routes restores flags. Latest: 5,520 pass, 0 fail.
- **Per-scenario evidence**: `data/scenarioEvidence.async.json` — 7 full-engineering (A08,A09,H04,H06,L03,L04,L05), 6 partial-pending-clinical (H01,H02,H03,D02,E04,G04), 2 blocked (H05,H07 — need reviewed guidance content). Builder B() reasons updated; matrix regenerated — still 72/120 by generator, not by hand.
- **USDA**: `USDA_IMPORT_APPROVAL_MANIFEST.md` — exact-match-only contract, null-preservation, provenance, rollback via sourceBatch tag. Awaiting owner authorization for fitness_test preview writes.
- **platformE2E**: needs `DATABASE_URL=fitness_auth_readiness` + real auth — skip is by design; to run: `TEST_DATABASE_URL=postgres://…fitness_auth_readiness npx jest tests/integration`.
- **Next**: USDA preview batch on fitness_test (owner checkbox) → mobile dataGaps rendering → remaining docs refresh.

## Cycle update — platformE2E live + connection-saturation fix + clinical packages

- **platformE2E runs green: 3/3** real-auth journeys on `fitness_auth_readiness` (schema drift fixed via db push; constraint warnings were empty-table adds — verified 0 rows). Run cmd in PLATFORM_E2E_READINESS.md.
- **Connection-saturation root cause CONFIRMED + FIXED:** `tests/setupAfterEnv.js` afterAll disconnect — 137 suite-clients vs max_connections=100. Latest run: 5,519 pass / 1 fail (was 5).
- **Residual (1):** exercises.route 'finished rejects sets' 400→405 once, order-dependent, standalone-green — next session: route-shadowing check.
- **Clinical packages appended** to CLINICAL_REVIEW_HANDOFF.md — 8 scenarios (H01–H03,H05,H07,D02,E04,G04) with verbatim expectation ↔ engineering evidence ↔ clinical decision ↔ specialty ↔ proposed fixture.
- **USDA:** manifest stands; 4 owner decisions unchanged — preview write needs explicit authorization.
- **Mobile:** `dataGaps` now rendered on Dashboard energy card (GAP_LABELS); tsc clean.
- Owner changes preserved: nutrientCompleteness/nutrientUnknowns wiring, voice/barcode serving fixes, anatomy a11y edits, maestro flow.

## Checkpoint — 2026-11-22 cycle 4

**Suite runs (isolated `--runInBand`, full):**
- Run A: 136/137 suites, 5,520 pass, 0 fail (skip=platformE2E-by-design→now separately green 3/3)
- Run B: 136/137 suites, 5,520 pass, 0 fail
- Run C: 134 pass/2 fail/1 skip — one recurrence observed (order-dependent); Run D: 136/137 clean. Failure class still under observation; exercises.route 405 instrumented with DIAG logging for next occurrence.
- Postgres: post-run conns = 1 (cleanup verified); max_connections=100.

**Done:** platformE2E 3/3 (fitness_auth_readiness, schema pushed, empty-table constraint adds only). USDA dry-run counts: 430 ingredients/186 fdc-linked/175 exact-match preview candidates. AUDIT_STATE.json written.

**Next:** identify the 2-failure recurrence in Run C → authorize USDA fitness_test preview → reviewer fixtures for 7 engineering-complete scenarios.

## Checkpoint — cycle 5 (USDA preflight + reliability)

- **USDA ceiling revised 175→40**: test catalog seeded with own IDs (0/175 match; 39 fdcId collisions). Eligible = test's own 40 fdc-linked, 0 existing profiles.
- **Schema corrections**: `source='USDA'` enum; no `sourceBatch` col → `sourceDataset='usda_fdc_usda-preview-1'`; `Nutrient` table empty in test (seed needed for nutrient rows).
- **Rollback verified** on synthetic record (PASS: idempotent upsert via identityKey, batch-scoped delete, cascade, re-rollback 0).
- **Durable logs**: `--json --outputFile=var/test-reports/` every run. Run E clean (5,520p/0f). 4-of-5 clean post-fix.
- **Awaiting**: owner auth for ≤40-row fitness_test insert + Nutrient seed; Run C recurrence IDs unknown (logs will capture).

## Checkpoint — cycle 6 (USDA import EXECUTED)

- 782 rows inserted into fitness_test (26 Nutrient/40 profile/716 join), atomic, IDs recorded.
- Reseed had rotated ingredient IDs — remapped by exact fdcId (same identity), re-verified.
- Key finding: consumers filter `verifiedAt:{not:null}` → batch is correctly invisible until review.
- Next: mobile provenance/confidence-label check; scenario matrix regen; next full suite w/ durable log.

## Checkpoint — cycle 7
- Flag-cache leak FIXED (FF_CACHE_TTL_MS=0 tests only): root cause of 4-failure class. Post-fix full suite 5,520p/0f.
- Review package for 40 profiles written; synthetic activation proves gating works.
- Mobile provenance validated — no fixes needed.
- Remaining: smartKitchen DIAG armed; reviewer decision on review package; matrix still 72/120.

## Checkpoint — cycle 8 (reviewer workflow implemented)
- /super-admin/nutrition-profiles live (RBAC NUTRITION_DATA_REVIEW, audit, concurrency-safe). 8/8 unit tests + real-DB E2E (approve→visible→revoke→invisible→member 403).
- 40 USDA profiles still unverified — awaiting human review.
- Suites: r2 clean 5,528/0f; r1 one socket-transient; platformE2E 3/3.
- Next: reviewer uses workflow on batch → reviewer fixtures for 7 scenarios.

## Checkpoint — cycle 9 (beta-readiness cycle)
- Fixed real regression: activitySafety.e2e mock missing findFirst (owner added clinician_documented path).
- Owner landed Smart Fiber Intelligence (7 flags ALL OFF, fiber.* test suites green, mobile card wired).
- Suites: 5832p/1f latest; residual = rare mock/real-boundary flake on moving codebase.
- Deliverables: BETA matrix, TEST_STABILITY_FINAL, USDA_REVIEWER_HANDOFF, SCENARIO_REVIEW_FIXTURE_HANDOFF, SECURITY_PRIVACY_RELEASE_CHECKLIST, MOBILE_E2E_ACCEPTANCE.
- Next owner: reviewer for 40 USDA profiles; fixtures for 7 scenarios; fiber flag rollout decisions; iOS staging build creds.

## Checkpoint — cycle 10 (beta stabilization)
- 5-run sequence: 4/5 clean (5,849 each); residual = 1 transient error-body flake / ~5 runs in mocked suites.
- Smart Fiber audit: PASS — honest taxonomy, no inference, supplement path medical-gated OFF.
- Fiber flags: 7/7 verified OFF + fail-closed live.
- Reviewer handoff + scenario fixture packages ready for owner assignment.
- Next owner: assign reviewers; fiber rollout decision; 8 clinical packages.

## Checkpoint — cycle 11
- Pool bound (connection_limit=2) applied; 8/9 valid runs clean. Residual 403-boundary flake unproven — evidence in seq*.json.
- Scenario review mechanism live: SCENARIO_REVIEWER + submit-scenario-review.js → hash-chained log; 7 scenarios promotable by owner's signature only.
- Fiber rollout plan staged: 4 wellness-eligible flags, supplement/AI/voice stay OFF.
- Owner edits noted: barcode mass-vs-volume (no 1ml=1g), workout maestro persistence flow.
- Next owner: sign 7 scenario reviews; device-run maestro; assign USDA reviewer; fiber stage-1 authorization.

## Checkpoint — cycle 12 (device E2E + flake root cause)
- FLAG CACHE ROOT CAUSE FIXED: '0'||60000 bug — stale per-user flag cache caused ALL transient 403s. Fix: honor env + per-test resetCache. Post-fix full suite clean.
- iOS Maestro REAL DEVICE RESULTS: dismiss+auth PASS; food-logging exposed ×100 nutrient display defect (936/2952/302.4/504) + save never reached backend — owner file, needs fix.
- Android BLOCKED: maestro device-server died on emulator-5554 — restart emulator/reinstall driver.
- Next: rerun suite 4× for stability claim; owner fixes FoodEntryScreen ×100; Android retry; then beta gate.

## Checkpoint — cycle 13 (P0 food-logging)
- ROOT CAUSE: stray keyboard input inflated servings to 225 (7200 g) → ×72 macro display; save taps hit the pad → nothing persisted. NOT a scaler bug.
- FIX: portionGuard.ts (5000 g cap) on qty+scale paths; Keyboard.dismiss() on save; 14/14 new tests; tsc clean.
- Device re-verify BLOCKED: maestro iOS driver crashes ~75 s in (fresh boot too); Android device-server dead. Owner: reinstall drivers (`maestro` / Xcode), rerun food-logging-verify + Android.
- Next: 4 more clean backend runs post cache-fix; Android; beta gate once device evidence exists.

## Checkpoint — cycle 13b (driver diagnosis)
- iOS/Android driver crashes root-caused: concurrent sessions per sim + near-zero free RAM. Driver itself fine (owner's runs complete).
- Owner is actively running maestro flows (muscle-explorer, recent-favorites, fiber-stage2 updated).
- Guidance: one session per device; close extra sims/Metro/emulator; then food-logging-verify → expect corrected macro display + successful save.

## Checkpoint — cycle 14
- Backend post-TRUE-cache-fix: 4/5 clean (seq18 = socket drop under memory pressure during owner's maestro runs).
- Owner is in a continuous maestro verification loop (muscle-explorer, recipe, recent-favorites on both sims) — device window for food-logging-verify requested; my P0 fix is in their served bundle.
- Next: run food-logging-verify single-session once a sim frees; Android after RAM recovers.

## Next (after 2026-11-22 cycle-15)
- iOS food-logging P0 CLOSED: maestro PASS + persisted row. Android verify still
  open — run in uncontended window or via owner CI (android-e2e.yml).
- Backend stability: 4/5 clean runs earlier + post-cache-fix run; any rerun
  should use unchanged revision + durable seq json.
- Owner gates: 7 scenario signatures, USDA reviewer, fiber stage approvals.

## After cycle-16 (2026-11-22)
- iOS food P0 CLOSED (device+DB evidence). Serving restoration verified
  not-a-defect; repeatMeal.ts + tests added.
- Android: watcher /tmp/android-watch.sh fires food-logging-verify on
  emulator-5554 when a maestro-free window appears; else CI workflow.
- Backend: 4 more runs preserved (2 clean; flakes = owner mock-gap + socket
  pressure, zero 403s).
- USDA: batch rematerialized into fitness_test (40 pending); reviewer still
  needed. If test DB reseeds again, re-run rematerialize-usda-preview.js --apply.
- Owner gates unchanged: 7 scenario signatures, USDA reviewer, fiber stages.

## After cycle-17
- Android yaml ready (`food-logging-verify-android.yaml`, staging fixture);
  rerun recipe in ANDROID_DEVICE_ACCEPTANCE.md (adb restart + timeout env +
  stylus dismiss). CI workflow is the durable path.
- USDA batch rematerialized (40/0); reseeds will wipe it again — re-run the
  script or provision a dedicated review DB (owner decision).
- Stability: seq20–23 preserved; flakes = owner mock-gap + host-RAM sockets.

## After cycle-18
- Android via CI only: `gh workflow run android-e2e.yml --ref feat/pose-coaching-impl -f build_source=local -f flows=food-logging-verify-android` (secrets E2E_STAGING_* first). Do NOT retry local emulator.
- Remaining owner gates unchanged.

## After cycle-20
- seq24–28 evidence filed; authSweep watchlisted (transient 401→200 once).
- Android CI dispatch still owner-gated (no gh on host).
- If gh appears: `gh workflow run android-e2e.yml --ref feat/pose-coaching-impl -f build_source=local -f flows=food-logging-verify-android`.
