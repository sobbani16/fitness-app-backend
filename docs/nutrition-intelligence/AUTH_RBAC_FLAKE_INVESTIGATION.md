# Auth/RBAC Flake — ROOT CAUSE FOUND & FIXED

## Symptom
~1 suite per ~4–5 full runs failed with transient 403s (trainerWorkoutPlans, photoScan, asyncScenarios 403-class), always a different suite, always standalone-green.

## Root cause
`src/services/featureFlags/service.js:27` — `Number(process.env.FF_CACHE_TTL_MS) || 60_000`: `FF_CACHE_TTL_MS='0'` evaluates `0 || 60_000` → **60s cache stayed active in tests**. A suite resolving flags for a shared userId (`trainer-1`, `client-1`, `alice`...) while its env had a flag off cached `false` for 60s → later suites using the same userId inherited stale `false` → fail-closed 403. Deterministic-standalone, nondeterministic-in-full-run — exactly the observed signature.

## Fix
1. `service.js`: honor the env explicitly (`!== undefined ? Number() : 60_000`) + skip cache get/set when TTL≤0.
2. `tests/setup.js`: removed the broken `FF_CACHE_TTL_MS='0'` line.
3. `tests/setupAfterEnv.js`: added global `afterEach(() => resetCache())` — per-TEST isolation while preserving intra-test caching (featureFlags.test.js cache-semantics suite still passes).

## Validation
- featureFlags + trainerWorkoutPlans + asyncScenarios: 25/25 pass
- Full suite post-fix: **150/150 suites, 5,849 pass, 0 fail** (var/test-reports/postcachefix.json)
- Production unaffected: unset env → 60s default unchanged.
