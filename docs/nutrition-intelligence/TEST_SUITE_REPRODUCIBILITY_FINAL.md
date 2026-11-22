
## Cycle 7 — flag-cache root cause RESOLVED

| Run | Result |
|---|---|
| F (pre-fix) | 4 fail: asyncScenarios 403, photoScan 404, labelInsights 404, voice socket-hang — all flag-gated routes |
| **Root cause** | `featureFlags` per-user cache (60s TTL) cached resolved flag maps **including env-override state**; shared userIds ('alice', test USER) let a suite's disabled flag leak ≤60s into other suites |
| **Fix** | `FF_CACHE_TTL_MS='0'` in `tests/setup.js` — disables cache in tests only; production unchanged |
| G (post-fix) | **136/137 suites, 5,520 pass, 0 fail** |
| Residual | smartKitchen `add.body.items[0]` undefined once (pre-fix run); DIAG armed; no flag gate on /grocery; standalone 21/21 |
| exercises 405 | No recurrence in 3 post-instrumentation runs; DIAG armed |

## Cycle 8 — post-cache-fix runs

| Run | Result |
|---|---|
| r1 | 136/137 suites, 5,527 pass, **1 fail**: profile.weight — socket parse error (transient socket-hang class, no assertion issue) |
| r2 | **137/137… 136 exec/1 skip, 5,528 pass, 0 fail** |
| platformE2E | **3/3** real-auth journeys |

Residual: sporadic socket-level drops (~1 run in 6) — likely single-suite server teardown race; DIAG instrumentation in place.
