# C10 — audit logs and operational administration

Implemented and locally verified October 18, 2026. Deployment and operator acceptance remain pending. These server changes serve both Android and iOS; no mobile binary change is required.

## Administrator workflow

Use the C09 independently reviewed bootstrap/recovery procedure to establish the first administrator. Sign in normally and use a bearer token. Device IDs and caller-supplied identity headers cannot grant access.

- `GET /audit-logs` requires `VIEW_AUDIT_LOGS`. Optional exact filters: `actorId`, `entityType`, `entityId`, `action`; ISO timestamp bounds `from`, `to`. `limit` is 1–100 (default 50), `offset` is 0–10000. Results retain the existing `{logs: [...]}` envelope, sort by timestamp then ID, and are not cacheable. Use a fixed `to` while paging to reduce movement from new events; offset pagination is not a transactional snapshot.
- `POST /admin/roles/assign` and `/remove` accept `{userId, roleName}` and require `MANAGE_ROLES`. Changing SUPER_ADMIN also requires that role. Assignments require an existing verified account. Record the intended change in the team's review process before sending it, then inspect the matching role event. There is no default password or public bootstrap route.
- Role mutations recheck privileges inside the transaction, serialize against other role writes, revoke target sessions and commit the audit together. Removing the last active SUPER_ADMIN is refused. A repeated assignment/removal is a no-op and does not duplicate audit events. The target must sign in again after a real change.
- `PATCH /admin/trainers/:id/verify` requires `MANAGE_TRAINERS` and an actual boolean `verified`. Profile, TRAINER grant, session revocation and audit are atomic. Verification requires a verified account and an existing TRAINER role. Missing RBAC setup fails rather than silently skipping the role.
- Unexpected database failures return generic errors, not database details. Retry after resolving the failure; do not manually patch a role to bypass a failed audit.

## Event coverage and data minimization

Atomic privileged events: `role.assign`, `role.remove`, `trainer.verify`; C09 separately provides atomic `admin.bootstrap` and `admin.recover`. Metadata includes actor, action, subject, timestamp, relevant state changes and revoked-session counts. C09 includes its review reference.

All currently exposed coaching write routes now commit their mutation and audit together using an explicit Prisma transaction client. Serializable transactions retry serialization conflicts at most twice; callbacks contain database work only. Trainer switching includes both the previous relationship completion and the new assignment in that transaction. Drop forms, relationship state and trainer rating changes roll back together. Subscription events record the previous trainer and new trainer without survey text.

| Route | Event | Covered writes |
| --- | --- | --- |
| POST `/trainers/signup` | `trainer.signup` | Pending trainer profile |
| PATCH `/trainers/me/profile` | `trainer.profile_updated` | Editable profile fields; values are not copied into audit |
| POST `/trainers/clients/assign` | `client.assign` | Trainer relationship |
| PATCH `/trainers/clients/:clientId/status` | `client.status_update` | Relationship status |
| POST `/trainers/:id/subscribe` | `trainer.subscribed` | Previous trainer completion and new subscription |
| POST `/trainers/clients/:clientId/drop` | `client.dropped_by_trainer` | Relationship and drop form |
| POST `/trainers/me/drop` | `trainer.dropped_by_client` | Relationship, drop form and aggregate rating |
| POST `/nutritionists/clients/assign` | `client.assign` | Nutritionist relationship |
| POST `/workout-plans` | `plan.create` | Plan and exercises |
| POST `/meal-plans` | `plan.create` | Plan and meal items |
| POST `/coach-notes` | `coach_note.create` | Trainer/nutritionist note; only client ID and visibility enter audit |

There are no coaching plan update/delete or note update/delete endpoints in the current API; future endpoints must extend this audit contract. Audit reads and rejected permission attempts do not create database events. This is an operational mutation trail, not a comprehensive security-access or compliance log.

Snapshots allow only bounded operational metadata. New records discard free-text plan titles, nutrition targets, drop reasons, nested payloads and credentials; historical API responses apply the same projection. Historical database payloads expire through retention; projection is not physical erasure. No API edits/deletes audit records. Database operators retain database access; these logs are not cryptographically tamper-evident.

## Retention

Hourly maintenance in the existing authentication worker deletes audit events older than 30 days. Old `admin.bootstrap` events become a non-personal completion marker (constant actor, null subject, empty snapshots), preventing TTL cleanup from reopening bootstrap. Related records are still removed by account deletion. Recent events remain available. Backup/provider retention remains the separate A04/D06 operational gate; local tests do not verify Railway backup expiry or worker uptime.

## Verification

- Backend unit suite: 289 tests / 33 suites passed.
- Dedicated PostgreSQL database with all 21 migrations and RBAC seed; `scripts/test-admin-operations.js` tests real bearer-auth HTTP access, spoofed identity rejection, bounded queries, verified targets, last-admin protection, injected audit failures and transaction rollback, session revocation, repeat requests, competing removals, trainer verification, historical redaction and retention/bootstrap-marker preservation.
- Coaching PostgreSQL/HTTP checks (`scripts/test-coaching-audit.js`): 12 successful-write/injected-audit-failure scenarios cover every current coaching write route, including both trainer and nutritionist notes. Complete coaching-table snapshots remain unchanged after failures. Tests also check authorization, private-text exclusion and competing capacity-limited subscriptions.
- Authentication/account integration regression: 37 tests / 5 suites passed. The historical-meal fixture was updated with the nutrition fields already required by the API; application meal behavior was unchanged.
- No production accounts, role grants, DNS, deployments or TestFlight builds were changed.

Reproduce database checks with Node 22 and a fresh empty local database named `fitness_c10_<suffix>`, apply migrations and `prisma/seed-rbac.js`, then run `DATABASE_URL=postgresql://<local-user>@127.0.0.1:55432/fitness_c10_<suffix> node scripts/test-admin-operations.js`. The script refuses other hosts/names and pre-existing users/audits. It removes its fixtures on completion.

## Remaining acceptance

Deploy the reviewed backend changes, verify hourly maintenance runs, rehearse grant/revoke/audit lookup with independently reviewed test accounts, and confirm backup retention. The identified coaching event coverage/atomicity gap is closed for all current write routes. New write endpoints must use the transaction and extend the coverage tests. No mobile native acceptance is claimed from server tests.

For coaching checks, use a fresh empty local `fitness_c10_<suffix>` database with migrations and RBAC seed, then run `node scripts/test-coaching-audit.js` with its DATABASE_URL. Do not run either destructive fixture script against a shared or live database. No schema migration was introduced by C10.
