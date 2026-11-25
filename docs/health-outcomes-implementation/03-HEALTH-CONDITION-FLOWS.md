# 03 — Health Condition Flows (F-C1)

**Status:** ENGINEERING_COMPLETE · **Flag:** `health_conditions` (server, default off, fail-closed)

## Backend
- `GET /health-conditions` (catalog) + `GET /me/health-conditions/catalog` — versioned registry, 40 slugs
- `GET/POST /me/health-conditions`, `PATCH/DELETE /me/health-conditions/:id` — user-scoped via `req.userId || getUserId(req)`; consent required on write; idempotent re-add; deactivate semantics
- Registry: `services/healthOutcomes/conditionRegistry.js` — slug normalization, allowed source/severity/stage, non-diagnostic education copy
- Plan revalidation: condition writes invalidate safety recommendations (client `invalidateSafetyRecommendations`) and conditions flow into `resolvePlan` + `generateFoodSuggestions`

## Mobile
- `HealthConditionsScreen` — search catalog, self-reported vs clinician-diagnosed Segmented control, consent checkbox, list/remove
- Linked from SummaryScreen behind `healthConditions` client flag

## Evidence
- `tests/healthOutcomes.test.js` — persistence lifecycle, idempotent re-add, cross-user isolation (26→32 tests, all pass)
- Seed: `scripts/seed-condition-registry.js` materialized 49 catalog rows

## Blockers
- CLINICALLY_READY requires approved+activated rules — none exist yet (governance implemented, no approvals fabricated)
