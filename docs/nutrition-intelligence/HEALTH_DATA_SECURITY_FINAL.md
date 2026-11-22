# HEALTH DATA SECURITY — FINAL VERIFICATION (H11)

## Verified this cycle (real tests, isolated `fitness_test`)

| Control | Evidence | Status |
|---|---|---|
| Cross-user symptom isolation | `asyncScenarios.api.test.js`: user B list never contains user A's report; PATCH cross-user → 404 | PASS |
| Symptom PATCH/DELETE owner-scope | `updateMany/deleteMany` both include `userId` in `where`; verified via route test + API test | PASS |
| Feature-flag fail-closed | Disabling `activity_safety_engine` → symptom POST returns 401/403/404 (tested) | PASS |
| Immutable record fields | PATCH data cannot contain `userId`/`reportedAt` (asserted in route test) | PASS |
| Clinical rule gating | Consumers filter `reviewStatus='APPROVED'`; approval ≠ activation (flag still required) | PASS |
| Advice invalidation | symptom create/patch/delete calls `invalidateSafetyAdvice` | PASS |

## Fixed this cycle

- **Jest child-process env leak** (`tests/academy.test.js`): jest replaces `process.env` with a JS object — `execSync` children read the real OS env, silently fell back to dev `.env` DATABASE_URL. Both call sites now pass `{ env: { ...process.env } }`. Audited all other `execSync`/`spawnSync` sites — only jest-level calls were exposed; `scripts/test-*.js` already pass env explicitly.
- **Schema defect:** GET /symptoms selected a nonexistent `notes` field → 500 on real DB (mocks masked it). Removed. Real-DB API test now covers the endpoint.

## Previously verified (unchanged)

- Test-DB guard: refuses remote/non-`fitness_test` hosts; `TEST_DATABASE_URL` swap before prisma load.
- `AUTH_TEST_BYPASS` is test-env only (`NODE_ENV==='test'` required) — cannot bypass production auth.
- RBAC + `requireFeature` on all activity-safety routes; trainer symptom access restricted by default (privacy tests).
- Audit logging on entitlement grants/revocations and editorial transitions.
- Restrictions delete is `superseded` (audit-preserving) for clinician-documented rows.

## Open items (owner / future work)

- Rate limiting: not comprehensively tested this cycle — verify gateway/middleware limits before production.
- Backup/rollback procedure: `scripts/test-deployment-readiness.js` exercises pg_dump/restore on operator demand — run it before any release.
- Audit-log integrity under tamper is asserted by schema only, not by adversarial test.
- Secrets live in `.env` (gitignored) — confirm secret-manager path for production.
- No destructive/production testing performed (by policy).
