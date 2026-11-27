# Reliability Battery — main @ df477ee (2026-11-27)
pc-HUM-38 §12: ≥5 complete backend regression runs on a stable SHA, per-run records, root-caused failures, no retry-to-green, failure logs preserved.

## Environment (CI-faithful by construction)
- Isolated worktree at exact SHA `df477eea2fcca1ec5df5ea02a5e5f9be7f332d86`; prisma client regenerated for that revision (stale-shared-client lesson applied).
- Dedicated scratch DB `fitness_test_h38` — `migrate deploy` all migrations clean, then the 4 CI seed steps (rbac, foods, safety, modules). DB dropped after; no shared/dev/prod data touched.
- `TEST_DATABASE_URL` swapped in by tests/setup.js with connection_limit=2; same DB reused across the 5 runs (harder than CI's fresh-DB-per-run — exposes cross-run residue).

## Per-run records (battery4 — correct instrumentation: direct exit capture, full logs preserved)
| run | exit | duration | failed | skipped | todo | passed | total |
|-----|------|----------|--------|---------|------|--------|-------|
| 1 | 1 | 31s | 1 | 4 | 48 | 6352 | 6405 |
| 2 | 0 | 26s | 0 | 4 | 48 | 6353 | 6405 |
| 3 | 0 | 27s | 0 | 4 | 48 | 6353 | 6405 |
| 4 | 0 | 30s | 0 | 4 | 48 | 6353 | 6405 |
| 5 | 0 | 28s | 0 | 4 | 48 | 6353 | 6405 |

Immutable revision: 197 tracked test files, zero uncommitted modifications. 4 skipped = documented env-gated integration suites (consistent with the suite-count reconciliation); 48 todo = pre-existing test.todo markers, not suppressions.

## Failure root-cause chain (evidence preserved in order of discovery)
1. **battery1 — misinstrumented, disclosed**: `jest | tail` captured tail's exit code and empty stdout tails; jest writes results to stderr. Additionally ran with no DB provisioned → 300 failures across 54 suites (PrismaClient errors). Not valid stability evidence; logs retained, methodology corrected. Even so: 6,053 mock-based tests passed DB-less.
2. **battery2 — unseeded scratch DB**: real instrumentation, 90–92 failures/run in 7 consistent suites + 4 single-run-only suites. Root cause: seed-dependent integration suites (academy, e2eTrainerJourney, trainerNutrition…) need the CI seed steps. Consistent-population analysis: 7 suites fail in ALL 5 runs → systematic, not flake.
3. **battery3 — seeded, wrong DB name**: 47 failures in exactly 4 suites. Root cause: `asyncScenarios*`, `securityEvents.login`, `fiberRecipeReconcileApply` carry hard safety guards — `expect(TEST_DB_URL).toMatch(/fitness_test/i)` / `throw 'api runner must target fitness_test'` — protective coupling so destructive fixture writes can never hit dev/prod. Classification: **test-infra name-coupling, not application regression**. Resolution: scratch DB named `fitness_test_h38` satisfies both the guards and the unlabeled-db warning regex.
4. **battery4 — CI-faithful**: table above.

## The one remaining failure — UNRESOLVED FLAKE, gate-blocker per card discipline
- run1 only: `tests/automation/authSweep.test.js` — `GET /supplements/safety` without token → **403 instead of 401/AUTH_REQUIRED**, 1 test.
- Signature matches docs/nutrition-intelligence/AUTH_RBAC_FLAKE_INVESTIGATION.md (fail-closed 403 from stale feature-flag state). That fix (TTL honoring + per-test resetCache) is verified PRESENT at df477ee — so a residual leak path remains. Suspected mechanisms: cross-file `process.env` inheritance in --runInBand (jest isolates module registry per file, NOT process env), or feature-gate-before-auth ordering interacting with per-file async resolution timing.
- Runs 2–5 fully green confirm nondeterminism (~1-in-5-run frequency, matching the historical ~1-per-4-5-runs rate).
- Per card: unresolved = gate blocker. Full logs preserved at /tmp/h38-runs/b4run*.log on the executing host; no retry-to-green performed — runs 2–5 are independent battery iterations, not retries of run1.

## Methodology errors self-caught (honesty record)
pipefail exit-capture bug; missing seeds; non-conforming scratch DB name — each detected from the evidence itself, corrected, disclosed here rather than hidden.

## Reproduction procedure (for any future battery)
```
git worktree add /tmp/rb <sha> && cd /tmp/rb && cp -R <deps> node_modules && npx prisma generate
createdb fitness_test_x && DATABASE_URL=...fitness_test_x npx prisma migrate deploy
npm run db:seed-rbac && node prisma/seed-foods.js && npm run db:seed-safety && node scripts/seed-modules.js
for i in 1..5: TEST_DATABASE_URL=...fitness_test_x npx jest --runInBand --ci > run$i.log 2>&1; echo $?
dropdb fitness_test_x
```
