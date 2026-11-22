# TEST_DATABASE_ISOLATION_REPORT (Sprint G Phase 0)

**Delivered:** `tests/setup.js` guard — runs before any suite imports prisma.
- `TEST_DATABASE_URL` set → replaces `DATABASE_URL` for the whole run (documented swap path to a dedicated test DB).
- Otherwise host must be localhost/127.0.0.1/::1 — **verified refusal** of `postgres://…@prod.example.com` ("REFUSING to run against non-local database host"). `ALLOW_REMOTE_TEST_DB=1` escape hatch for a deliberately remote test instance.
- Local-but-unlabeled DB → loud warning that fixture writes may touch dev data.
- No credentials/URLs printed beyond host name in the refusal.

**Honest limits:** a dedicated empty test DB is not yet provisioned — the mechanism + enforcement exist; provisioning `TEST_DATABASE_URL` (e.g. `…/fitness_test`) + `prisma migrate deploy` against it is the remaining owner/ops step. Until then, suites still target the local dev DB (with the warning) — risk unchanged but now guarded against remote/prod accidents.
