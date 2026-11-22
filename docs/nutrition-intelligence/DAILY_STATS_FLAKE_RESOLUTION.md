# RESIDUAL FLAKE ANALYSIS (Phase 3/7)

## History

1. **Dev-DB coupling** (fixed): shared `fitness_app` caused 0–18 nondeterministic failures. Resolved via `fitness_test` + `TEST_DATABASE_URL` swap + host guard + reference seeds.
2. **execSync env leak** (fixed this cycle): jest's `process.env` is a JS object; `execSync` children read the real OS env and fell back to dev `.env`. Both `academy.test.js` call sites now pass `{ env: { ...process.env } }`.

## Current residual — order/data-dependent, NOT reproduced

Observed once in a 137-suite run: `energySummary.test.js` (2 tests — response body was an error object, `b.resting`/`b2.active` undefined), `voice.test.js` (404 on flag-gated route), `chat.route.test.js` (socket hang up after limiter 429). A clean run immediately before had 0 failures.

**Evidence:**
- `GET /energy/summary` has no flag gate; records seeded via prisma directly. Undefined `b.resting` ⇒ response was `{error}` (401/404/5xx) — the route itself rejected, not assertion mismatch.
- `voice.test.js` never enables `voice_food_logging`/`voice_exercise_logging` itself — it **implicitly depends on leaked flag state** from other suites (`requireAnyFeature` fails closed → 404). Fragile either way.
- `activitySafety.routes.test.js` sets engine flags `'false'` in its gating describe and **does not restore** — env vars persist in the shared in-band process. This is a real (minor) leak: suites running afterward see flags off. Other suites (`messaging`, `scheduling`, `e2eTrainerJourney`, `trainerCommerce`) do the same for their own keys.
- Chat limiter: `createDailyLimiter` per-suite module registry — cross-suite leak unlikely; socket-hang-up more consistent with the route hitting an exception path.

**Reproduction attempts (all green):** `academy+energySummary`, `asyncScenarios.api+e2eTrainerJourney+usdaService+energySummary`. Failure needs the specific jest suite ordering that triggered it.

## Status

- Root cause NOT yet proven; most consistent hypothesis: **feature-flag env leaks** (suites set `FF_*`/envOverrideName to false without restore) + possible date-boundary sensitivity in energy tests.
- No assertions weakened; no tests skipped to hide it.
- Cheapest durable fix (not yet applied): a `restoreFlags`/`afterAll` pattern in the polluting suites, and self-sufficient flag setup in `voice.test.js` and `energySummary.test.js`.

## Root causes resolved this cycle

1. **`voice.test.js` 404** — CONFIRMED + FIXED. The suite builds its own mini-app and never enabled `voice_food_logging`/`voice_exercise_logging`; `requireAnyFeature` fails closed → 404. It only passed when an earlier suite (jest's non-deterministic ordering) leaked `FF_*='true'` envs. Fix: beforeAll enables its own flags. Standalone-verified.
2. **`chat.route.test.js` socket hang up** — same class: POST /chat requires `ai_coach`; suite never enabled it. Fix: beforeAll sets `FF_AI_COACH='true'`.
3. **`energySummary.test.js` ×2** — mechanism not yet proven (GET path has no flag gate). Instrumented with `expect(res.status).toBe(200)` so the next occurrence reveals the error body. Passed in latest run.
4. **`activitySafety.routes.test.js`** — added afterAll flag restore (was leaking 'false' envs to later suites).

**Latest full suite: 136/137 suites, 5,520 tests, 0 failures** (1 skip = platformE2E by design).

## Cycle 3 — root cause CONFIRMED: Postgres connection saturation

**Mechanism (proven):** `max_connections=100` on local Postgres; each jest suite holds a fresh `PrismaClient` (module registry per file) with `connection_limit=5`; only ~4 suites disconnect. Accumulated idle connections saturate Postgres mid-run → subsequent suites get `socket hang up` on DB ops, `403 FEATURE_DISABLED` when the flag-service DB read fails closed, and order-dependent error bodies. Ordering variance explains the earlier 0-fail run.

**Fix:** `tests/setupAfterEnv.js` (new, registered via `setupFilesAfterEnv`) — global `afterAll` disconnects the suite's `getPrisma()` client. Mocked-prisma suites hit the try/catch harmlessly.

**Result:** run A post-fix → 5,519 pass / **1 residual**: `exercises.route.test.js` 'finished session rejects sets' expected 400 got 405 — order-dependent, not yet root-caused (both stores return 400/409, not 405; suspect route shadowing). Passes standalone. Under investigation; no assertion weakened.
