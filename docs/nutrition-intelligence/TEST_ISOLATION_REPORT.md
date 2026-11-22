# TEST_ISOLATION_REPORT — shared-DB flakiness

## Observed

Full-suite runs: `tests/photoScan.test.js` (recipeMatches[0] undefined; matches[0] undefined) and `tests/exerciseLibrary.test.js` fail **intermittently** — both pass standalone and passed the most recent full run (1,218 tests, 1 fail = pre-fix A06 assert only). Failure signature: name-based recipe matcher returns empty when the shared dev DB returns other suites' leftover recipes first or fixtures were cleaned mid-run.

## Root cause

Shared development Postgres. Suites create real rows (recipes `Ps*`, `ms*`, ingredients, users) and cleanup deletes overlap across suites when `runInBand` ordering shifts. `mealSuggest.test.js` had the same disease — fixed earlier with prefixed fixtures + self-cleanup. photoScan/exerciseLibrary fixtures are prefixed (`Ps*`, `sk*`) but the **matcher queries are unscoped** (scan all Recipe/Ingredient rows), so foreign residue can outrank or crowd the limit.

## Remediation plan (not yet applied)

1. Scope matcher queries in tests by normalized-name prefix (`sk%`, `Ps%`) — deterministic candidate set.
2. `beforeAll` fixture creation + `afterAll` FK-ordered cleanup in both suites (precedent: `mealSuggest.test.js`).
3. Longer term: schema-level test isolation (per-suite schema or testcontainers) — dev DB is shared with manual testing, never production.
4. Add suite-order shuffle run in CI to expose leaks.

## Status

OPEN — documented; not fixed this session (no destructive ops run; no tests weakened). Both suites pass in isolation and in the latest full-suite run; the flakiness is environmental, not a product defect.
