# C09: controlled administrator provisioning and recovery

Implemented and tested October 17, 2026. No real administrator was created and no production database was modified. This runbook requires a trusted database operator and independently reviewed ownership/authorization; possession of an app session, device ID or email address alone is not sufficient.

## Policy

- Individual administrators register through normal authentication, verify their email and use their own strong password. No default/shared credentials, password printing, auto-verification, seed admin or public bootstrap endpoint.
- First provisioning grants SUPER_ADMIN, the role required to manage other super administrators. Only use it for the independently approved platform owner. Provision narrower day-to-day roles through existing authorized administration flows.
- Bootstrap is allowed only when there are no ADMIN/SUPER_ADMIN assignments, including inactive ones, and no prior `admin.bootstrap` audit record. Existing administrators use normal role management; loss of administrator access uses the recovery mode below.
- Both modes default to read-only preview. Applying requires `--apply`, `--reviewed`, and the exact SHA-256 preview state, bound to the database host/name, target account state, privileged-role inventory, permissions, mode, operator and review reference.
- Preview is not proof of authorization. The operator checks the intended environment, registered account UUID and independently recorded review before attesting. The CLI can record this review but cannot establish human identity or approval itself.
- Do not include names, health details, credentials or email addresses in operator/review references. Use opaque internal identifiers/ticket references.

## Preconditions

1. Use the intended beta/staging/production environment explicitly. Public production rollout remains a separate decision.
2. Make a protected backup and confirm restore access. Restrict database/operator credentials using deployment controls; the app must not expose this command as an HTTP endpoint.
3. Apply migrations and the existing RBAC seed. The command requires the SUPER_ADMIN role and its core management/audit permissions; it never creates or changes permissions itself.
4. Obtain the approved existing account UUID through the trusted administrative/database process. Independently verify owner identity and approved scope in a restricted ticket. A separate reviewer should check the target and environment.
5. Supply DATABASE_URL through a secure operator environment, not command arguments, pasted chat, checked-in files or shell history. The command intentionally does not implicitly load `.env`.

## First administrator

Use actual opaque references in place of these placeholders. Running without apply only returns a plan:

```sh
npm run admin:provision -- --mode bootstrap --user-id ACCOUNT_UUID --operator OPERATOR_REF --reference REVIEW_TICKET
```

Review the printed host/database, target UUID, role, inventory count and effects. No password, hash, token or complete database URL is printed. Preview holds short transaction locks but performs no database writes.

After independent review, repeat the same arguments and add:

```text
--apply --reviewed --expected-state SHA256_FROM_PREVIEW
```

A stale or changed target/review fails closed; preview again. Grant/reactivation, revocation of **all target account sessions**, and the audit record commit in one transaction. The target must sign in again. Successful output includes an audit ID. Confirm the intended role and protected admin action with the fresh session; revoked sessions must fail. Review audit metadata without copying secrets into tickets.

Concurrent bootstrap calls are serialized against ordinary role writes using PostgreSQL table locks. Only one can bootstrap. On a timeout/deadlock, no success is claimed: resolve contention and preview again. If output is lost after commit, inspect the audit record and current assignment before any recovery attempt. Do not assume an interrupted CLI means rollback.

## Lost-access recovery

Use this only through the independent owner-review process, with a new recovery ticket. Restore account access using the normal email/password lifecycle, or approve a new individually registered and verified account if the original cannot be recovered. Rotate compromised credentials before granting access.

Preview with `--mode recover`, then apply with its matching state and review flags. Recovery may reactivate an inactive grant or grant the approved replacement account. It revokes the target's existing sessions and records `admin.recover` atomically. It deliberately does **not** remove other administrator grants, reset passwords, verify email, or bypass normal sign-in. Review/revoke compromised old privileges separately using a trusted active administrator; do not remove the last trusted administrator accidentally.

The audit actor is `operator:OPERATOR_REF`, not the target user pretending to act. Before/after metadata contains the target UUID, role, reference, review attestation, revoked-session count and preview hash. Existing audit retention/access policies apply; this task does not silently define a new retention period or change account deletion behavior.

## Validation

- 266 backend unit/API tests across 31 suites passed, including strict CLI parsing, explicit-apply requirements, target redaction and validation before database access.
- A dedicated disposable localhost database (`fitness_c09_*`) received all 21 migrations and the RBAC seed.
- Real PostgreSQL/HTTP tests cover read-only CLI preview, refused unconfirmed apply, missing/unverified/passwordless targets, incomplete RBAC, stale previews, changed review reference, transaction rollback on injected audit failure, eight concurrent bootstrap attempts, revoked sessions, fresh authenticated RBAC, spoofed identity-header rejection, reviewed recovery and historical-bootstrap reuse rejection.
- Test credentials are generated in memory and never printed. Fixtures are removed; the runner refuses non-local or non-dedicated/nonempty databases. No production account was provisioned.

Run on a new dedicated local database after migrations and RBAC seed:

```sh
node scripts/test-admin-provisioning.js
```

DATABASE_URL must already point to that disposable localhost database. The runner does not create production users or send emails. A real operator rehearsal, reviewer assignment and deployment of the command remain operational acceptance gates.
