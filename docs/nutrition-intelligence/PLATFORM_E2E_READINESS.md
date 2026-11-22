# PLATFORM E2E — READINESS + RESULT

## What it is

`tests/integration/platformE2E.test.js` — golden-path E2E over the **real auth path** (`AUTH_TEST_BYPASS=false`): Mind & Habits, Food Intelligence barcode→log, Wearables connect→ingest→dedup→recovery. It skips by design unless `DATABASE_URL=fitness_auth_readiness` — it must never run against dev/prod.

## Environment (this cycle — completed)

- DB: `fitness_auth_readiness` (local Postgres, pre-existing, 175 tables).
- Schema drift found: `FoodLog.micronutrients` + 2 unique constraints missing → `prisma db push` applied. Both constraint warnings were on **empty tables** (verified 0 rows) — `--accept-data-loss` used safely; no data lost.
- Users: synthetic `randomUUID()@example.test` rows created by the suite itself; real `hashPassword`+`createSession`; `emailVerifiedAt` set.
- Run: `TEST_DATABASE_URL=<readiness-url> npx jest tests/integration/platformE2E.test.js --runInBand`

## Result: 3/3 PASS (real auth)

- Mind & Habits: opt-in → check-in → history → edit → insights → exercise → delete ✓
- Food Intelligence: barcode → product → suitability → evidence → scan-result → log ✓ (caught the micronutrients schema gap — now fixed)
- Wearables: connect → ingest → dedup → trends → recovery → disconnect keeps data ✓

## Note

Do NOT point regular suites at this DB — `fitness_test` remains the unit/integration target; `fitness_auth_readiness` is reserved for real-auth E2E.
