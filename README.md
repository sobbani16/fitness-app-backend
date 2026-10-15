# Fitness App — Backend (Node + Express)

## Requirements
- Node.js >= 18

## Setup
```bash
npm install
cp .env.example .env
npm run dev     # nodemon, :4000
npm test        # Jest + supertest
```

## Endpoints (MVP)
- `GET  /health` — liveness check (implemented).
- `POST /meals` — stub for meal logging.
- `GET  /recommendations` — stub for workout/diet suggestions.
- `GET  /summary/daily` — stub for daily summary.
- `POST /chat` — stub for AI chat (will enforce 5/day).

## Structure
```
src/
  index.js          server bootstrap
  app.js            express app (middleware + routes)
  routes/           one file per resource
  controllers/      (future) thin handlers
  services/         calorieEngine, recommendationEngine, weatherService, aiService
  utils/            logger
tests/              Jest + supertest
```

## Next step
Implement calorie engine + rule-based recommendation engine with unit tests.

## Password recovery and email verification (A03)

Auth email configuration is now required at startup. Set `RESEND_API_KEY`,
`AUTH_EMAIL_FROM`, `AUTH_LINK_SECRET` (32 random bytes as hex), and
`AUTH_PUBLIC_URL` (HTTPS backend origin); see `.env.example`. Run
`npm run db:generate` and `npm run db:deploy` before starting the server.
The embedded worker processes transactional email with durable retries.
Existing accounts must verify their email before accessing account data.

`npm run test:auth` runs real-database tests against the disposable localhost
`fitness_auth_readiness` database only. It deletes fixture data in that database
and stubs outbound email; never use a production database. The older endpoint
smoke harness now also verifies fixture accounts and requires the same
`AUTH_LINK_SECRET` as its target test server.

Detailed setup, API behavior, evidence and remaining staging/device checks:
`fitness-app-mobile/docs/A03_AUTH_LIFECYCLE.md` in the sibling mobile repository.

## Account privacy (A04)

`/me/account/export` and `/me/account/delete` require a bearer session plus the
current password. Deletion additionally requires `confirmation: "DELETE"`.
Unverified accounts retain access to these routes. Apply both account lifecycle
migrations before deployment; they add deletion receipts and database guards
against late writes to deleted accounts. Hourly maintenance prunes expired
receipts/auth records. Hosting must separately enforce backup/log/provider
retention and replay deletions before restoring traffic from a backup.

The real-database suite (`npm run test:auth`) now includes both A03 and A04 and
truncates tables in the dedicated localhost `fitness_auth_readiness` database.
See the sibling mobile repository's `docs/A04_ACCOUNT_LIFECYCLE.md` for the
ownership rules, retention policy, test evidence and native-device release gates.

## Legacy device-ID migration (A05)

Apply `20261014100000_legacy_migration` before enabling migration. A device ID
is never proof of ownership. After an independent ownership review, the trusted
operator can issue an account-bound single-use code with
`scripts/issue-legacy-migration.js`; see its required flags and the sibling
mobile repository's `docs/A05_LEGACY_ACCOUNT_MIGRATION.md`.

Redemption requires the verified destination account's bearer session and
current password. Supported member accounts are upgraded in place only when
the destination has no data; populated or privileged accounts are rejected for
separate review. No actual legacy account was claimed during development.

### Meal photo recognition (N08)

Configure server-only `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-4o-mini`). `FOOD_AI_USER_DAILY_LIMIT` (30) and `FOOD_AI_GLOBAL_DAILY_LIMIT` (100) bound daily attempts across `/meals/detect` and `/meals/analyze`; zero disables calls. Failed provider attempts count, and SDK retries are disabled. These are request budgets, not dollar limits. Live acceptance requires real photos and credentials; run `node scripts/food-photo-smoke.js clear-meal.jpg ambiguous-meal.jpg non-food.jpg` against a running API using local `FOOD_SMOKE_API_URL` and a verified session in `FOOD_SMOKE_TOKEN`. See the mobile repository's `docs/N08_FOOD_PHOTO_RECOGNITION.md` for acceptance and limitations.

Text-only meal analysis uses `/meals/analyze`, retaining portion basis, uncertainty and review flags. Run `node scripts/meal-text-smoke.js` with the same `FOOD_SMOKE_API_URL` and verified `FOOD_SMOKE_TOKEN` for three live text cases. Live acceptance requires a configured provider key; automated SDK mocks are not evidence of live success. See `docs/N09_TEXT_MEAL_ANALYSIS.md` in the mobile repository.
