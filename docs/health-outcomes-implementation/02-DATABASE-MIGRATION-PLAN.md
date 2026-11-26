# 02 — Database Migration Plan

**Status:** APPLIED (dev + test + disposable DBs) · **Migration:** `20261227000000_health_outcomes_p0`

## What the migration adds
- `HealthCondition`: `slug`, `category`, `evidenceClass`, `education`, `registryVersion`, `registrySource`
- `UserHealthCondition`: `source`, `severity`, `stage`, `diagnosedAt`, `consentAcknowledgedAt`, `lastConfirmedAt`, `notes`, `updatedAt` (backfilled for existing rows)
- `ConditionRule` / `HealthConditionNutrientRule` / `ActivitySafetyRule`: `version`, `activeAt`, `activatedBy`, `expiresAt`, `retiredAt`, `retiredBy`, `reviewDueAt`
- `ClinicalRuleReview` enum: + `IN_REVIEW`, `REJECTED`, `RETIRED`
- New tables: `Medication`, `UserMedication`, `ClinicalMeasurement`, `ClinicalRuleEvent`, `UserClinicalReview`
- Indexes on user/date/metric + governance lookups

## Method (drift-safe, per AGENTS.md)
1. `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` → generated SQL
2. Isolated pre-existing drift (Recipe indexes `sourceKey`/`reviewStatus` already exist in DB — DB ahead of migration history) — excluded from the migration
3. `updatedAt` on `UserHealthCondition` backfilled (`createdAt`) before `NOT NULL`
4. Applied manually, `prisma migrate resolve --applied` — never `migrate dev`/`reset`

## Verification
- `npx prisma validate` → pass
- `npx prisma migrate status` → only pre-existing `20261225000000_pose_coaching_sessions` remains unapplied (untouched, not ours)
- Same SQL applied to `fitness_test`; disposable `fitness_auth_readiness` synced

## Rollback
Additive-only: new columns nullable-with-defaults, new tables freestanding. Rollback = drop new tables + drop new columns + `migrate resolve --rolled-back`. No data mutation required to revert.
