# Backend agent notes

## Verify
- Tests: `npx jest tests/<file>.test.js --runInBand` (or `npm test` — jest already runs in-band).
- Module sanity: `node -e "require('./src/routes/supplements'); require('./src/services/supplements/schedules')"`.
- Prisma: `npx prisma validate`, `npx prisma migrate status`. **Never** run `migrate dev`/`migrate reset` blindly — the local DB has pre-existing drift (edited `20261211000000_platform_expansion`) and a reset destroys data. Generate SQL with `npx prisma migrate diff --from-migrations --to-schema-datamodel`, apply with `prisma migrate dev --create-only`-equivalent or manual `prisma migrate resolve`.

## Supplement intelligence (added 2026-11-18)
- Catalog statuses: `published` / `candidate` / `review_only` / `personal` / `archived` on `Supplement.catalogStatus`. `review_only` items never appear in browse — only in search, labeled `research: true`.
- Import: `node scripts/import-supplements.js --apply` (dry-run default). Sources live in `data/imports/` — `humai_supplement_research_seed_v1.json` is primary (207 items, 47 draft safety rules — all `approved=false` until clinical review).
- Dose occurrences are dedupe-keyed (`userId|schedule|date|slot`) — `generateOccurrences` is idempotent; call it freely from ticks/syncs.
- `POST /supplements` is admin-only for shared catalog; non-admin writes become owner-scoped `personal` supplements. Never bypass `req.userId` — the global `authenticate` middleware already rewrites `x-user-id`.
- Test mocks: route tests must mock every prisma model the handler touches (`supplementDoseOccurrence`, `supplementSchedule`, `reminderPreference`, `userHealthCondition`, `userAllergy`, `supplementInteractionRule`, `conditionRule`, …).

## Test database environment trap (root-caused 2026-11-26, cost multiple cards)
- The machine's shell environment exports `TEST_DATABASE_URL` pointing at
  `humai_qa_test` (QA infrastructure's database — intentionally near-empty).
  dotenv does NOT override existing env vars, so the repo `.env` value
  (`fitness_test`, fully provisioned) silently loses and every DB-backed suite
  lands in the wrong database with `The table public.User does not exist`.
- This is NOT a schema/provisioning problem — do not reset or migrate anything.
- To run real-DB suites as the repo intends:
  `TEST_DATABASE_URL="$(grep '^TEST_DATABASE_URL' .env | cut -d= -f2- | tr -d '\"')" npx jest tests/<file> --runInBand`
- `humai_qa_test` belongs to QA automation — never provision or mutate it.
