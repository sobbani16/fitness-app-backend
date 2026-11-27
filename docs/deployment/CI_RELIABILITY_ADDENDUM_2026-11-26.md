# CI Reliability Addendum — full backend suite ×5 (2026-11-26)

Supplements `CI_RELIABILITY_AUDIT_2026-11-25.md` (mobile worktree hum32, commit `228cda0`).
Branch `humai/dev-06/pc-HUM-38-ci-audit`, base `origin/main` `3650bbb`, worktree hum38.

## Result: 5/5 CLEAN full-suite runs

Jest exit code 0 on every run (properly captured — not grep-masked):

| run | dur | suites | tests |
|-----|-----|--------|-------|
| 1 | 28s | 157 passed, 2 skipped / 159 | 6075 passed, 4 skipped, 48 todo / 6127 |
| 2 | 36s | identical | identical |
| 3 | 23s | identical | identical |
| 4 | 23s | identical | identical |
| 5 | 22s | identical | identical |

Zero failures, zero inter-run variance. The run-to-run result hash is identical —
no flake signature in the full suite under `--runInBand` on a quiet host.

## Root-cause finding: stale shared Prisma client masquerading as test failures

First ×5 attempt (symlinked `node_modules`) failed deterministically: 2 suites /
7 tests in every run plus one extra suite in one run (the intermittent candidate).
Identity: `tests/asyncScenarios.test.js` + `tests/asyncScenarios.api.test.js` —
both in the prior FLK class.

Error: `PrismaClientKnownRequestError: The column 'version' does not exist in the
current database` on `userSymptomReport.create()`.

Investigation chain:
1. `prisma/schema.prisma` at `origin/main` has **no** `version` column on
   `UserSymptomReport` — the test inserts nothing wrong.
2. The generated client at `node_modules/.prisma/client/schema.prisma` (timestamp
   Nov 25 11:25) **does** require `version Int @default(1)` — it was generated
   from a feature-branch schema during another worktree's session.
3. Worktrees symlink `node_modules` from the main checkout for jest. Any agent
   running `prisma generate` in any worktree overwrites the shared client for
   every other worktree. Whichever branch generated last wins; all others run
   tests against a client that matches neither their schema nor the test DB.

This is an environment-level false-failure generator: deterministic when the
touched model is exercised, intermittent-looking when suite ordering/load varies
(the one extra suite in v1-run3 was the same artifact class).

### Fix applied (verification environment only)

`cp -Rc` APFS clone of `node_modules` into the hum38 worktree (copy-on-write —
near-zero disk cost, instant), then `npx prisma generate` from this branch's
schema. `version` reference gone; both async suites pass 17/17 in isolation;
full suite then green ×5. No application code changed — none was broken.

### Recommendation (test-infrastructure policy)

- Worktrees that share `node_modules` by symlink MUST regenerate the Prisma
  client from their own branch schema before testing if the schema differs —
  or clone `node_modules` (`cp -Rc` on APFS) as this audit did.
- A cheap guard: test-setup asserts the generated client's schema hash matches
  `prisma/schema.prisma` (fail fast with "stale prisma client — run generate").
  Not implemented here (touches shared test setup — separate increment).

## Migration-drift verdict re-confirmed

`npx prisma migrate status` against `fitness_test`: all migrations through
`20261227000000_health_outcomes_p0` applied — test DB is NOT behind. The failure
was never missing migrations; it was the client artifact above. The previously
documented local-DB drift classes (edited `20261211000000_platform_expansion`,
missing `20261118120000_smart_kitchen` on the dev DB) remain as recorded.

## Flake classification update

- v1's deterministic 7 failures: environment artifact (explained above) — NOT
  product defects, NOT test flakes.
- v1-run3's single extra failure: same artifact class under different timing —
  did not reproduce in any of 5 clean-environment runs.
- The earlier pc-HUM-143-era load-flake (1 non-reproducing failure in 8 combined
  batteries) remains the only unexplained candidate; consistent with the prior
  pc-HUM-38 load-sensitivity note. No reproducer exists.

## Verdict

Backend full suite: stable — 5/5 clean, 30k+ test executions, zero genuine
failures. Combined with the mobile ×5 from the base audit, the "5 clean runs"
criterion is met for both repos. CI-side remains: runs must execute in CI itself
(secrets/runners), and the prisma-client staleness guard is the one concrete
test-infrastructure hardening this audit surfaces.
