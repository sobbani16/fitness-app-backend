# Backend agent notes

## Verify
- Tests: `npx jest tests/<file>.test.js --runInBand` (or `npm test` — jest already runs in-band).
- Module sanity: `node -e "require('./src/routes/supplements'); require('./src/services/supplements/schedules')"`.
- Prisma: `npx prisma validate`, `npx prisma migrate status`. **Never** run `migrate dev`/`migrate reset` blindly — the local DB has pre-existing drift (edited `20261211000000_platform_expansion`) and a reset destroys data. Generate SQL with `npx prisma migrate diff --from-migrations --to-schema-datamodel`, apply with `prisma migrate dev --create-only`-equivalent or manual `prisma migrate resolve`.

## Test database provisioning (added 2026-11-27, defect #330)
- `node scripts/provision-test-db.js [url]` — idempotent, migration-driven provisioning. Positively identifies local test databases only (refuses remote/unlabeled), serializes concurrent provisioners with a Postgres advisory lock, applies `prisma migrate deploy` + reference seeds (`seed-rbac`, `seed-nutrients` — both idempotent; demo seeds deliberately excluded), verifies every schema table exists afterward. Fast path ~100ms when current.
- **jest `globalSetup` runs it automatically once per run** — you never need to provision manually. If it throws, read the refusal: it names the exact problem (drifted ledgerless copy vs unreachable vs unprovisionable).
- **Env trap**: the shell may export `TEST_DATABASE_URL` and dotenv never overrides existing env vars — the exported value wins over `.env`, always. Know which database your run targets: it is printed in the globalSetup line.
- `fitness_test` is a **drifted ledgerless copy** (copied dev data + out-of-band pushed tables, no `_prisma_migrations`) — provisioning rightly refuses it. `humai_qa_test` (the shell-injected default) IS fully migration-provisioned. Drifted copies are not baselined automatically — provisioning never guesses.
- Suites must be self-contained: seed your own fixtures. Never `findFirst()` a User you didn't create — a correctly provisioned test database starts empty of user data.
- Suites must not hardcode a database NAME — guard with `require('./testDbUrl').isPositiveTestDatabase(url).ok` instead.

## Supplement intelligence (added 2026-11-18)
- Catalog statuses: `published` / `candidate` / `review_only` / `personal` / `archived` on `Supplement.catalogStatus`. `review_only` items never appear in browse — only in search, labeled `research: true`.
- Import: `node scripts/import-supplements.js --apply` (dry-run default). Sources live in `data/imports/` — `humai_supplement_research_seed_v1.json` is primary (207 items, 47 draft safety rules — all `approved=false` until clinical review).
- Dose occurrences are dedupe-keyed (`userId|schedule|date|slot`) — `generateOccurrences` is idempotent; call it freely from ticks/syncs.
- `POST /supplements` is admin-only for shared catalog; non-admin writes become owner-scoped `personal` supplements. Never bypass `req.userId` — the global `authenticate` middleware already rewrites `x-user-id`.
- Test mocks: route tests must mock every prisma model the handler touches (`supplementDoseOccurrence`, `supplementSchedule`, `reminderPreference`, `userHealthCondition`, `userAllergy`, `supplementInteractionRule`, `conditionRule`, …).
