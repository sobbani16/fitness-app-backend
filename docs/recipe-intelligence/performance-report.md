# Performance Report — Recipe Intelligence

**Status:** measured component costs + identified bottlenecks; no load-test
numbers yet (PERF-001 pending — no fabricated figures below).

## Per-request work (as implemented)

| Endpoint | DB queries (worst case) | AI calls | Notes |
|---|---|---|---|
| `/match-ingredients` | 6 constraint queries + 1 recipe fetch + N×catalog | 0 | N = # recipes with ingredients; each `violatesHard` is in-memory |
| `/generate` | 6 constraint + catalog load + retry/save | 1–4 | 1 initial + ≤1 correction × ≤3 candidates (bounded by `maxRetries:1`); fallback adds match query |
| `/save-generated` | 6 constraint + 1 create + line creates | 0 | |
| `/customize` | 6 constraint + recipe fetch + catalog + update | 1 | plus full revalidation pass |

## Measured hot spots

1. **`loadConstraints` is 6 sequential prisma round-trips** — could be
   parallelized (`Promise.all`) for ~5× wall-clock on the constraint phase.
   Not done yet; correctness-first.
2. **`loadCatalog` fetches the whole catalog** per validate call (currently
   228 rows — fine; needs an indexed/lookup map if catalog grows >5k).
3. **No cache** — every request re-runs constraints + validation. Safe but
   wasteful; `constraintVersion`/`validatorVersion` keys exist for a future
   versioned cache (CACHE-001 design requirement: key must include the
   constraint hash — restriction changes must not read stale results).

## Observed (jest timing, not load)

- 79 tests across all paths complete in ~2 s — in-memory validator cost is
  negligible vs AI round-trips.
- `askJSON` latency dominates `/generate` + `/customize` (provider-bound).

## Recommendations

1. `Promise.all` the six constraint queries (safe, no semantics change).
2. Cache the catalog map per-request (already single fetch); add a TTL cache
   keyed by catalog `updatedAt` max if hot.
3. Add per-route rate limiting on `/generate` (AI cost protection).
4. PERF-001 gate: p95 `/generate` target ≤ 15 s (AI-bound), `/match-ingredients`
   ≤ 300 ms, `/customize` ≤ 15 s — measure before release signoff.
