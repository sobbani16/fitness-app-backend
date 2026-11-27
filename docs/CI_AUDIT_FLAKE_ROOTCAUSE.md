# CI Reliability — AUTH_RBAC Flake Root-Cause & Fix (2026-11-27)

## The gate blocker, root-caused

The residual flake from the df477ee battery (unauthenticated probes returning
403/404 instead of 401, ~1 in 5 runs) is fully explained by the interaction of
three facts, each verified experimentally:

1. **Jest reorders test files across runs** — 232 ordering-diff lines between
   consecutive same-SHA runs (sequencer timing-based ordering). Any cross-file
   state leak therefore lands on a *different* victim suite each run, which is
   why the flake "migrated" between suites across batteries.
2. **`process.env` is shared across all files in the in-band worker** — module
   registries reset per file but the environment does not. Test files mutate
   flag env vars at module level, in hooks, and in tests; nothing restored them
   at file boundaries.
3. **The flag cache could be poisoned by in-flight resolutions** — `resetCache()`
   per test clears the map synchronously, but a flag resolution promise already
   in flight during a flag-off test can complete and re-populate the cache
   *after* the reset. The next test sharing the userId cache key then reads a
   stale flag-off resolution for up to the 60s TTL. Timing-dependent, rare,
   order-dependent — exactly the observed signature. `FF_CACHE_TTL_MS=0`
   (the §12 prescription) was never actually set in `tests/setup.js`.

## Fixes (this branch)

- `tests/setup.js`: `FF_CACHE_TTL_MS='0'` — with TTL=0 the service never writes
  cache entries, structurally closing the in-flight poisoning race.
- `src/services/featureFlags/service.js`: TTL read dynamically instead of frozen
  at module load, so tests can opt into cache behavior explicitly.
- `tests/featureFlags.test.js`: cache-semantics test opts in explicitly.
- `tests/setup.js` + `tests/setupAfterEnv.js`: pristine-env snapshot captured
  once per worker after bootstrap; restored at every file end (afterAll) —
  module-level/hook/test mutations can no longer cross file boundaries.
  Per-test snapshot/restore handles intra-file leaks.

## Battery evidence (same SHA, seeded scratch DB `fitness_test_h38`)

| battery | fix state | results |
|---|---|---|
| battery2 (baseline harness bug — seeds hit wrong DB; disclosed) | none | 43-44 fail/run — harness error, discarded |
| battery3 | env isolation only | 3/5 clean; 1-2 fails in 2 runs, still 403-class |
| battery4 | + TTL=0 | **5/5 runs: zero auth-class (403/404-vs-401) flakes**; runs 1-4 fully clean (6147 passed each) |

The auth-class flake — the original gate blocker — did not occur once in
battery4's five runs.

## Remaining unresolved failure (separate class, gate blocker stands)

`battery4/run5`: `tests/activitySafety.routes.test.js` — PATCH injury painLevel
validation expected 400, received 502, once in five runs. NOT flag-related:
the validation logic itself is correct on inspection; 502 implies an upstream
throw in the stateful sequence (injury creation in an earlier step possibly
failing under ordering-dependent DB state, making the PATCH target invalid).
Requires its own root-causing with the failure log preserved at
`/tmp/h38-fixruns/b4run5.log` on the dev machine. Per the card: unresolved =
gate blocker — CI is not yet certifiably green, but the blocker is now a
single characterized failure class instead of a diffuse flake population.

Frequency note: pre-fix the auth-class flake appeared in ~1/5 runs with 1-2
victims; post-fix zero occurrences in 5 runs. n=5 is small — the honest claim
is "not observed in 5 consecutive runs", not "impossible".
