# Trainer Platform — Seed Data & Backfill

Date: 2026-10-31 · Scripts: `prisma/seed-trainers.js`, `prisma/backfill-trainer-platform.js`.

> ⚠️ **LOCAL / DEV DATABASES ONLY.** Neither script is for production. `seed-trainers.js` creates fictional users with a shared known password — running it against prod is forbidden without explicit approval (per implementation plan §5). The backfill mutates live consent/application state; prod apply needs the same approval gate as any migration.

## 1. `node prisma/seed-trainers.js`

Creates recognizable synthetic data so trainer dashboards/discovery have content.

| Creates | Details |
|---|---|
| 10 trainer `User` rows | `trainer1..10@humai-seed.example`, `firstName 'Sample'`, `lastName 'Trainer N'`, `emailVerifiedAt` set, scrypt `salt:hash` password (`SEED_TRAINER_PASSWORD` env, default `Trainer-Seed-Passw0rd!`) |
| `UserRole(TRAINER)` per trainer | requires `node prisma/seed-rbac.js` first — script throws if the role is missing |
| `TrainerProfile` per trainer | tiers **4 standard / 4 pro / 2 elite**; `verified:true, active:true, applicationStatus:'approved', approvedAt:2023-02-01`, `isDiscoverable:true`, `maxClients:10`, synthetic `rating`/`ratingCount`, `hourlyRate` (dead field, seeded for realism), varied `specialties` (taxonomy ids — note seeds use ids like `weight_loss`/`HIIT`/`powerlifting`; labels/ids outside `config/specialties.js` taxonomy pass through the seed because it writes the array directly, not via `normalizeSpecialties`), `displayName 'Sample Trainer N'`, location/country/timeZone/languages/coachingMode |
| `TrainerCertification` rows | 2–3 per trainer: first `verified` (credentialId `SCB-1xxx`), second `pending_review`, third `unverified` for pro/elite. Legacy `certifications String[]` kept in sync with cert names |
| 3 client `User` rows | `client1..3@humai-seed.example` |
| 3 `TrainerClient` relations | client_n ↔ trainer_n, `status:'active'`, `requestedBy:'client'`, `startedAt` = now−14d |
| 8 `TrainerClientConsent` rows per relation | all `status:'granted', policyVersion:'v0-legacy', grantedAt:startedAt` |
| ~14 days of activity per client | `DailySteps` daily; `SleepLog` nightly; `WeightEntry` every 2 days; `FoodLog` 2 meals/day; `WorkoutSession`+3 `ExerciseSet` every other day — deterministic pseudo-random (`det()`), `source:'seed-trainers'`, `externalId 'seed-trainers:clientN:<kind>:<date>'` |

### Idempotency

Every write is `upsert` on a natural key or `findFirst`-then-`create`:

| Table | Key |
|---|---|
| User | `email` unique |
| UserRole | `@@unique(userId,roleId)` |
| TrainerProfile | `userId` unique |
| TrainerCertification | `findFirst(trainerId,name)` — no DB unique constraint |
| TrainerClient | `@@unique(trainerId,clientId)` |
| TrainerClientConsent | `@@unique(relationId,category)` |
| activity rows | `externalId`/`recordedAt`/`loggedAt` natural keys via `ensureRow` |

Re-running produces identical rows (deterministic `det()` generator) — never duplicates.

### Run / reset

```bash
node prisma/seed-rbac.js          # prerequisite (roles)
node prisma/seed-trainers.js      # seed
# reset: delete the seed users — trainer/client emails cascade:
#   prisma.user.deleteMany({ where: { email: { endsWith: '@humai-seed.example' } } })
# (FK Cascade removes profiles, relations, consents; activity rows on owned
# models delete via user cascade. Activity rows are identifiable by
# source='seed-trainers' / externalId prefix if manual cleanup is preferred.)
```

## 2. `node prisma/backfill-trainer-platform.js`

Post-migration data-consistency script (see TRAINER_DATABASE_DESIGN.md §5):

| Step | Writes | Guard |
|---|---|---|
| applicationStatus | `verified:true` profiles → `approved` + `approvedAt` | only rows not already approved or missing approvedAt |
| certifications | `certifications[]` → `TrainerCertification(verificationStatus:'legacy')` | `findFirst(trainerId,name)` skip |
| consents | `active`/`paused` relations → all 8 categories `granted`, `policyVersion:'v0-legacy'` | upsert `update:{}` — **never overwrites** a later explicit grant/revoke |

Idempotent; safe to re-run after partial failures.

## 3. Differences vs the plan

| Plan said | Reality |
|---|---|
| 10 trainers 4/4/2 tiers + 3 clients + activity | ✅ as written |
| certs 'legacy' on backfill | ✅ |
| — | seed relations use `v0-legacy` granted consents (not `v1` pending) so dashboards render immediately — matches backfill semantics, intentionally |
