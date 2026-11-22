# Staging Deployment & Live Write-Path Validation (Phase 17 §4/§5)

## Staging deployment — NOT DEPLOYED (honest status)

No authorized staging environment/credentials exist on this machine. `scripts/staging-preflight.js` passes locally (env, migration status, seed state). Nothing was deployed; nothing claimed.

**Exact human actions required** (in order, per `docs/deployment/activity-safety-staging-runbook.md`):
1. Provision staging Postgres + app env: `DATABASE_URL`, `AUTH_LINK_SECRET`, `OPENAI_API_KEY`; optional `DATA_GOV_IN_API_KEY` (CPCB), `POSTHOG_API_KEY`.
2. `npx prisma migrate deploy` on the staging DB.
3. `node scripts/seed-activity-safety-rules.js --apply` — rules stay DRAFT (CHECK constraint enforced).
4. Deploy backend build; enable flags per runbook order (`weather`/`environment` before `health_aware_recommendations`).
5. `node scripts/staging-preflight.js` against staging env; run `tests/activitySafety.e2e.test.js` + `activitySafety.scenarios.test.js` against staging base URL with synthetic accounts.
6. Rollback: feature flags off; rules remain DRAFT regardless.

## Live write-path validation — dev DB, synthetic user only ✅

Executed `/tmp/writepath.js` against the authorized dev database (real schema writes; synthetic user created + fully deleted — zero real records touched):

| Step | Result |
|---|---|
| Create synthetic user | ✅ |
| Create `UserActivityProfile` (walkingAbility, medicationActivityFlags) | ✅ — flags visible in safety context (`["heat_sensitivity"]`) |
| Create `UserInjury` (ankle fracture, `non_weight_bearing`) | ✅ |
| Engine eval via real `loadSafetyContext` — `outdoor_walk` | ✅ `BLOCK_ACTIVITY` (NWB propagates live) |
| Engine eval — `seated_movement` | ✅ `ALLOW` |
| Create `UserActivityRestriction` (clinician, trunk_load, prohibited) → `strength_training` | ✅ `BLOCK_ACTIVITY` |
| Create `UserSymptomReport` (chest_pain) → `outdoor_walk` | ✅ `URGENT_ESCALATION` |
| Create `Recommendation` → `invalidateSafetyAdvice` | ✅ `staleAt` set; `{recommendationsStale:1}` |
| Resolve symptom → `seated_movement` | `BLOCK_ACTIVITY` — **correct**: clinician trunk restriction still active (symptom resolution does not clear unrelated restriction) |

All 8 safety-relevant write paths proved end-to-end through the real Prisma schema → real context loader → real engine. J12 live proof: stale-stamping works on real rows. Cleanup verified — no synthetic residue.
