# D03 — deployment preparation and database readiness

October 18, 2026. Implemented locally; hosted Railway pre-deploy execution still requires acceptance. The existing Railway service remains the TestFlight beta. No public production environment or rollout was created.

## Release contract

1. Build installs dependencies and generates Prisma. Keep `prisma/migrations` and `src/config/rbac.js` in the deployed artifact.
2. `npm run deploy:prepare` validates authentication configuration before database writes, applies committed migrations, seeds the required RBAC catalog atomically, then runs `npm run deploy:check`. A failing command stops the sequence. It does not create users or user-role grants.
3. In `NODE_ENV=production`, server startup checks committed migration names/checksums, unresolved migration failures and every required role-permission mapping before starting the email worker or HTTP listener. A skipped pre-deploy step therefore fails closed.
4. `/health` remains liveness. Railway now targets `/health/ready`, which checks database connectivity and, in production, the same migration/RBAC requirements. Responses expose only ready/unavailable, not database details. Non-production retains the lightweight connectivity probe.

RBAC definitions are shared between seeding and verification. Seeding is additive for required mappings; it does not remove reviewed custom mappings or assign users. Readiness verifies migration history, not arbitrary manual schema drift or backward compatibility with an older binary. Newer completed migrations are permitted when all this binary's required migrations still match; that alone does not prove a rollback is compatible.

## Railway acceptance

The existing `railway.json` preDeployCommand array matches Railway's documented configuration. No evidence established why the previously deployed service did not apply migrations automatically, so this change does not claim to have diagnosed or repaired a dashboard/root-directory override.

Before deploying, verify the service root/config path includes this repository's `railway.json`, NODE_ENV is production, and the resolved deployment configuration contains:

- Pre-deploy: `npm run deploy:prepare`
- Start: `npm start`
- Health check: `/health/ready`

Review deployment details and pre-deploy logs for the readiness success message, then verify the new deployment's readiness endpoint before assigning beta traffic. If the hook was skipped, do not bypass startup verification; correct deployment configuration and repeat the reviewed deployment.

Railway documents that failed pre-deploy commands stop deployment and that repository configuration is combined with dashboard settings: [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), [configuration reference](https://docs.railway.com/config-as-code/reference).

## Failure and rollback procedure

- Take a protected snapshot and record the current deployment artifact before migrations. Confirm the snapshot can restore to a separate database.
- Missing migration: inspect the resolved deployment configuration and run the reviewed preparation against the intended database. Never use `migrate dev`, `db push`, or schema reset on the beta/live database.
- Failed migration: stop the release. Inspect the actual database and migration failure privately, determine which statements committed, then review a forward repair or restore plan. Do not blindly mark it applied or alter history to satisfy the guard.
- Changed checksum: restore the original committed migration; introduce a new migration for further changes. Do not edit applied SQL.
- Missing RBAC: review intended permission changes, then repeat preparation. A temporarily removed required mapping will be restored by seeding; permanent policy changes must change the shared catalog.
- Prefer rolling the application back only when the previous artifact is compatible with the current database. A database restore can lose post-snapshot writes: stop writes first, restore to a separate database, replay deletion receipts as required by A04, verify data and readiness, and only then change the connection. Neither this rehearsal nor checksum verification proves historical binary compatibility.

## Verified locally

- 296 backend tests / 34 suites passed.
- Fresh guarded localhost database `fitness_d03_20261018_final`: invalid authentication config made no database changes; production startup refused an empty database.
- Preparation applied all 21 migrations and seeded required RBAC. Running it twice preserved catalog counts and left users/user-role grants empty.
- Altered migration checksum and removed permission mapping each made production startup fail and `/health/ready` return 503. Restoring the original checksum and re-running preparation returned readiness to 200.
- `pg_dump`/`pg_restore` restored the prepared catalog/schema snapshot into a separate local database; the restored database passed migration/RBAC checks. The temporary dump was private and removed afterward. This is not a production-data, deletion-replay, point-in-time recovery or previous-binary rollback drill.
- No Railway data, deployment settings, secrets, accounts, pushes or TestFlight builds were changed.

Reproduce with Node 22, PostgreSQL tools under `/opt/homebrew/bin`, and a new empty local database named `fitness_d03_<suffix>`. Set its DATABASE_URL and run `node scripts/test-deployment-readiness.js`. The script refuses other hosts/names and nonempty databases, and creates a separate `<name>_restore` database. Never reuse a shared database for fixture scripts.

D03 remains hosted-acceptance pending. D06 still requires real backup policy, deletion replay, monitoring/alerts and an accountable rollback operator.
