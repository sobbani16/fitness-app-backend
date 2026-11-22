# TEST SUITE REPRODUCIBILITY (Phase 7)

## Runs this cycle (isolated `fitness_test`, `npx jest --runInBand`)

| Run | Suites | Tests | Failures |
|---|---|---|---|
| Prior checkpoint | 135/136 (1 skipped) | 5,509 | 0 |
| This cycle, run A | 136/137 (1 skipped) | 5,516 pass | 4 (energySummary ×2, voice, chat) |

The suite count rose 135→136→137 because `asyncScenarios.api.test.js` was added.

- Skipped suite: `tests/integration/platformE2E.test.js` — intentionally gated on `DATABASE_URL=fitness_auth_readiness` (real-auth E2E). Skips by design when tests run against `fitness_test`. Not a gap.
- 3 skipped tests + 48 todo are pre-existing.
- Flake status: see `DAILY_STATS_FLAKE_RESOLUTION.md`. Flag-env leaks identified as the leading hypothesis; the energy failures were error-body responses (route rejected), consistent with leaked flags or rare boundary conditions — not yet root-caused.

## Targeted suites (all green, deterministic)

| Suite | Result |
|---|---|
| asyncScenarios.api.test.js (new) | 7/7 — authenticated HTTP + real DB |
| asyncScenarios.test.js | 10/10 — service + real DB |
| activitySafety.routes.test.js | 22/22 — incl. new PATCH/DELETE tests |
| academy.test.js | 6/6 — after env fix |
| trainerNutrition / e2eTrainerJourney | pass — after seeds |
| Mobile (`npx jest src`) | 426/426 |
| Mobile `tsc --noEmit` | clean |
| `npx prisma validate` | (schema unchanged this cycle) |

## Environment

`TEST_DATABASE_URL=…fitness_test` (local Postgres), swap logged before prisma load; remote-host guard verified; RBAC + membership-module seeds applied; USDA_API_KEY present (dry-run fetch verified 10/10 fdcIds, file-cache only, no app-DB writes).
