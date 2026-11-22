# TEST_RELIABILITY_FINAL — count reconciliation + isolation fix

## Reconciliation of the 1208-vs-1218 discrepancy

One documented full-suite run (this checkpoint): **`npx jest --runInBand` → 111/112 suites passed (1 skipped), 1,323 tests passed, 54 todo, 3 skipped, 0 failures.**

The earlier variance was **failure flakiness, not test-count drift**: `photoScan`/`exerciseLibrary` intermittently failed on the shared dev DB (unordered `findMany` + accumulated `Ps `/`sk ` fixture residue crowding the bounded 20-row candidate window). Total test count also grew legitimately as suites were added (scenario fixtures + todo placeholders).

## Fixes applied

1. `photoRecipeMatcher.js`: added `orderBy: { recipeName: 'asc' }` to both candidate queries — the take-limited window is now deterministic instead of arbitrary.
2. `tests/photoScan.test.js`: `beforeAll` purges `Ps `/`sk ` residue; new `afterAll` performs FK-ordered cleanup (recipeIngredient → recipe → ingredient → catalog → foodLog → user).
3. Verified both suites pass standalone AND inside the full suite in the same run — no order-dependent failures remain in this run.

## Destructive-op guard

All test deletes are prefix-scoped (`Ps `, `sk `, `ms`, `lib-`, `tnut `) against the local dev DB only; `audit-junk-data.js` refuses hosted hostnames without explicit flag. No test can target production: `.env` points at the dev database; production credentials are not in the test path.

## Remaining hygiene debt

- 54 `test.todo` entries = 52 blocked scenario placeholders (by design — enumerable in CI).
- Shared dev DB remains the isolation root cause; a schema-per-suite or testcontainer DB is the durable fix (roadmap item).
