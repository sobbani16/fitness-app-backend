# TEST_ISOLATION_FINAL (Sprint F Phase 5)

**Root cause identified: shared real-database coupling, not env pollution.**

Investigation:
- Failing suites (`scenarioMatrix`, `identity`, `exerciseLibrary`, `reviewPackage`) each pass standalone; failures migrate run-to-run with identical alphabetical order → NOT ordering.
- No `process.env` mutation in any failing suite; express-rate-limit correctly `skip`s in NODE_ENV=test.
- Tests use the real Prisma client against the shared LOCAL DEV DATABASE (`identity` creates real users; `exerciseLibrary` creates real sessions). Fixture/connection state varies with suite length and DB drift → nondeterministic failures.
- Secondary hazard: `reviewPackage` injury fixtures use literal `2026-11-22` timestamps — a time bomb that will permanently fail after +72h (Nov 25) unless made relative.

**Required fix (infra work, not done):** dedicated test database (or per-suite truncation + `prisma.$disconnect` audit), and relative-date fixtures (`new Date(Date.now()-h*3600e3)`). Owner's `Recommendation.staleAt/staleReason` schema drift is orthogonal but underscores the need for an isolated test DB.
