# Defect #245 Reproduction — `npx jest tests --runInBand` (2026-11-27)

Authorized by decision #182 (approved: non-destructive reproduction in the hum77
worktree with disposable Postgres; no live credentials, no shared state).

## Reproduction environment

- SHA: `2990b06aa9d616b41d9aed6e8297d7f69227fb76` (hum77 branch = main + pc-HUM-77 security increments)
- node v20.20.2; `.env` absent in worktree (documented, never required)
- Scratch DB `fitness_test_h77sec` (name satisfies destructive-write guards), migrations applied clean,
  seed chain executed per `.github/workflows/test.yml` with `DATABASE_URL` explicitly exported —
  seed scripts read `DATABASE_URL` NOT `TEST_DATABASE_URL` (the pc-HUM-38 harness trap; avoided here)
- Seed verification: 11 Role rows present before any test ran
- Full logs preserved at `.audit-logs/defect245/repro1.log`, `repro2.log` (untracked, durable)

## Results — defect REPRODUCED

| run | exit | tests |
|---|---|---|
| repro1 | **1** | **2 failed**, 4 skipped, 48 todo, 6357 passed, 6411 total |
| repro2 | **0** | 0 failed, 4 skipped, 48 todo, 6359 passed, 6411 total |

repro1 failures:
1. `tests/trainerNutrition.test.js` — consent-gated trainer progress: expected 200 after consent granted, received **403**
2. `tests/energySummary.test.js` — GET /energy/summary: `TypeError: body.sync undefined` — response shape missing
   because the request never reached the handler (gate-blocked error body)

## Classification: matches-known-class (pc-HUM-38 AUTH_RBAC flake class)

Not a new class; not environment-setup (proven by repro2 passing identically-configured).

Evidence chain:
- **Victim disappearance**: the same two suites pass completely in repro2 — same SHA, same DB, same process
  environment. Only execution ordering/timing varied. This is the signature pc-HUM-38 documented:
  nondeterministic jest file ordering (measured: 232 ordering diffs between same-SHA runs) makes any
  cross-file leak land on a different victim — or no victim — each run.
- **Failure shape consistency**: both repro1 failures are gate-blocked responses on endpoints behind
  feature/consent gates. 403-after-consent-grant and undefined-response-body are the flag-resolution-corruption
  signature surfacing through different assertion styles (status equality vs body-field access).
- **Vector presence confirmed in this branch**: neither pc-HUM-38 fix is present here — no `FF_CACHE_TTL_MS=0`
  in tests/setup.js (in-flight cache poisoning race open), no file-boundary env restoration (cross-file
  process.env leakage open). `tests/trainerNutrition.test.js` itself mutates `FF_TRAINER_*` env vars at
  module level; `trainer_nutrition_guidance` dependsOn `trainer_advanced_features` in the resolution chain,
  so cache poisoning of either key produces exactly the observed 403.

## What this defect record does NOT mean

- It does not prove application-level defects in nutrition or energy endpoints — the same endpoints pass
  when ordering doesn't align the leak. The defect is test-infrastructure coupling, exactly as pc-HUM-38
  root-caused.
- The fix exists (unmerged) on `humai/dev-06/pc-HUM-38-ci-audit` — TTL=0 + dynamic TTL read + file-boundary
  env isolation, with battery evidence of zero auth-class flakes in 5 consecutive runs. Merge serialization
  is the founder's decision; this card does not port another workstream's unmerged fix.

## Cross-posting note

This reproduction independently confirms pc-HUM-38's root-cause analysis on a DIFFERENT branch with a
different test population (6411 vs 6199 tests) — the flake class is branch-independent infrastructure
coupling, not an artifact of any single branch's test set.
