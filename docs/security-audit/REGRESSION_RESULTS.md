# Regression Results

| Suite | Result |
|-------|--------|
| tests/trainerCommerce.test.js | 23/23 PASS |
| tests/securityHardening.test.js | 10/10 PASS |
| formChecks + viewAs + personalPlans.catalog + personalPlans.review + menuAnalysis | 40/40 PASS |
| Full backend suite (npx jest --runInBand) | 156 suites, 6003 tests, 0 failures, 4 skipped, 48 todo |
| Module load sanity (app + touched modules) | PASS |

## Dependency audits (npm audit --omit=dev)
- backend: 7 (3 moderate, 4 high) — prisma/effect, deepmerge-ts, swagger-jsdoc→glob/minimatch
- mobile: 17 (16 moderate, 1 high — image-size)
- web: 5 (1 moderate, 4 high — playwright, postcss, zod<4.6.6)
- admin: 0

## Untested / blocked
- No real payment provider exists to integration-test against (mock-only by design).
- CI workflow unverified end-to-end (not yet run in GitHub Actions).
- Mobile/web/admin test suites not re-run this pass (no code changes there beyond .env untracking).
