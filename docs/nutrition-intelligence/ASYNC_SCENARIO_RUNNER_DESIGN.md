# ASYNC_SCENARIO_RUNNER_DESIGN

`tests/asyncScenarios.test.js` — real async service execution on the isolated `fitness_test` DB.
- Guard: `beforeAll` refuses unless `DATABASE_URL` contains `fitness_test` (dotenv loaded first in setup.js — previously never loaded, so the swap silently didn't happen; FIXED).
- Unique synthetic users per scenario (`async-<tag>-<rand>@syn.local`); scoped `deleteMany` cleanup on created ids only; relative timestamps (no expiring dates).
- Exercises REAL services: `getTrends`, `getSymptomContext` (they call `getPrisma()` internally — no mocks of business logic).
- Fidelity tiers kept separate: these are DB-backed service-level tests — distinct from pure-function CAP fixtures and from API/mobile tiers; clinical approval still separate.
