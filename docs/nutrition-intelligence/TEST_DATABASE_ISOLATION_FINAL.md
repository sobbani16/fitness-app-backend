# TEST_DATABASE_ISOLATION_FINAL — COMPLETE (H1)

- `fitness_test` DB provisioned (local Postgres); `TEST_DATABASE_URL` in `.env` (local, `fitness_test`).
- Schema applied via `prisma db push` (fresh DB — avoids the `20261211000000_platform_expansion` drift history).
- `tests/setup.js` guard swaps DATABASE_URL→TEST_DATABASE_URL before any prisma import; remote hosts still refused; no permissive prod fallback.
- **Verified: full suite 134/135 suites, 5,491 tests, 0 failures** — prior 0–18 nondeterministic failures eliminated; shared-dev-DB coupling confirmed as the root cause.
- Remaining hardening: seed any reference data suites need; add CI TEST_DATABASE_URL provisioning step.

## Update (this session): child-process env + reference seeds

- **execSync env gap fixed:** jest replaces `process.env` with a JS object, so `execSync` children do NOT inherit jest-level swaps. `weekly-publish.js` was silently falling back to dev `.env`. Fixed in `tests/academy.test.js` by passing `{ env: { ...process.env } }` explicitly. Any test spawning backend scripts must do the same.
- **Reference seeds on `fitness_test`:** `prisma/seed-rbac.js` (11 roles / 39 perms / 72 mappings) + `scripts/seed-modules.js` (membership modules). Suites depending on them: academy, trainerNutrition, e2eTrainerJourney — all green.
- **Latest full suite:** 135/136 suites (1 skipped), 5,509 tests, 0 failures, 48 todo.
