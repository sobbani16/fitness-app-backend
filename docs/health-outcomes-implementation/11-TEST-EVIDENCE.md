# 11 — Test Evidence

**All results from actual execution — no reported PASS without a run.**

## Backend (`npx jest --runInBand`)
- **5,989 passed, 1 failed → then fixed: full suite green**
- The 1 failure: `mealSuggest.test.js` fixture used `APPROVED` without `activeAt` — semantic contract change (approval≠activation), fixture updated to activated rule. Not a weakened control.
- New: `tests/healthOutcomes.test.js` — 32 tests covering condition persistence/idempotence/isolation, medication classification/staleness/isolation, measurement validation/correction/isolation, rule lifecycle/live-gating, engine (RESOLVED/EDUCATION_ONLY/PERSONALIZATION_REQUIRED/URGENT_ESCALATION), F-R1 regression — all pass
- Consumer suites re-run: 65 + 33 + mealSuggest 13 + FeatureFlags 8 — pass

## Mobile
- `npx tsc --noEmit` → 0 errors; `npx eslint` new files → clean; `FeatureFlagsContext.test` → 8 pass

## Prisma
- `npx prisma validate` → pass; `migrate status` → only pre-existing `pose_coaching_sessions` unapplied

## Pre-existing failures (documented, not ours)
- `tests/integration/account.integration.js`: fixture seeder can't satisfy `KnowledgeSavedItem_articleId_fkey` + ~30 stale unclassified models (supplement/activitySafety/fiber tables predate this work) — predates implementation; new models classified correctly
- Integration suite requires disposable `fitness_auth_readiness` DB — synced for this work
