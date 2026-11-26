# CI Reliability Addendum 2 — §12 reconciliation + flake capture (2026-11-26)

Branch `humai/dev-06/pc-HUM-38-ci-audit` @ `8b3f7fb` + this commit. Extends
`CI_RELIABILITY_ADDENDUM_2026-11-26.md`.

## 1. The 136/137-style suite-count reconciliation — RESOLVED

Suite census at this SHA: 159 total, 157 executed, 2 skipped. The 2 skipped
suites are `tests/integration/platformE2E.test.js` (3 tests) and
`tests/integration/retentionSweep.test.js` (1 test) — exactly accounting for
the 4 skipped test cases (3+1). They are NOT suppressed-for-green: both use
`SAFE_DB ? describe : describe.skip`, an environment gate that runs them only
against the dedicated disposable `fitness_auth_readiness` database.

Runtime proof this session (DATABASE_URL+TEST_DATABASE_URL both pointed at the
migrated disposable DB, replicating the CI step exactly): **2/2 suites, 4/4
tests PASS**. Verdict: skipped tests are legitimate environment gating.

**Real gap found + fixed**: CI's integration step invoked only
`platformE2E.test.js` — `retentionSweep.test.js` executed NOWHERE in automation
(a suite that passes but never runs = silent coverage loss). Fixed in this
commit: test.yml integration step now invokes both.

## 2. FF cache isolation / env inheritance validation

- FF cache isolation: real mechanism is `resetCache()` in `afterEach`
  (tests/setupAfterEnv.js:16). The card's presumed `FF_CACHE_TTL_MS=0` knob
  does not exist in the codebase — documented as equivalent-but-different.
- TEST_DATABASE_URL swap: enforced in tests/setup.js with remote-host refusal
  and pool bounding (`connection_limit=2`) — verified reading + in practice.
- Prisma cleanup: per-suite scoped deletes + disconnect (asyncScenarios pattern);
  no cross-suite pollution observed in 10 clean-environment runs total.

## 3. Metadata-enriched reliability battery — 4/5 clean, ONE FLAKE CAPTURED

5 complete runs @ `8b3f7fb` (immutable SHA), results in
`automation/reliability-runs.json` (per-run suites/tests/skips/duration/
memory/connections best-effort). All failure logs preserved:
`docs/deployment/FLAKE_EVIDENCE_run4_memberAB.txt` — never deleted.

Run4 failure (the only one): `tests/authorization.memberAB.test.js` —
`POST /conversations/conv-b/report` expected 403, got 404, once in 5 runs.

### Flake root-cause analysis (honest status: mechanism isolated, defect not yet fixed)

- The suite uses an in-memory mock prisma — no real DB involved. Production
  path is a single deterministic query chain (`loadParticipantConversation` →
  findUnique + requireRelationParticipant). Variance across identical-order
  in-band runs can only originate inside the mock's include/where emulation
  (tests/authorization.memberAB.test.js:260-266) or ordering-sensitive
  include resolution for the nested `relation.trainer` include.
- Classification: **test-infrastructure (fixture/mock) defect candidate** —
  no evidence of an application bug; the production service code is
  deterministic single-query. Not CI-platform, not staging, not account.
- Per card rule: unresolved flakes are gate blockers — this remains OPEN.
  Next step: instrument the mock's findUnique/applyInclude with a trace of
  matched rows during a failing run (repro is ~1/5, cheap to farm).
  This is the SAME frequency class as the pc-HUM-143-era load-flake —
  plausibly one root cause family in the shared mock helpers.

## 4. §6 Android CI — evidence cross-posted from pc-HUM-32 (dedup)

android-e2e.yml inspection + remediation executed ONCE in pc-HUM-32 this
session @ mobile `5113c0b`: pinned maestro cli-2.12.1 verified, interpolation
injection FIXED (env-var-only + allowlist, locally proven), secrets presence
preflight, SHA-pinned actions, least-privilege permissions, concurrency/
timeouts/retention present. Execution of the lane itself remains blocked on
E2E_STAGING_* secrets — same needs_human ask, cross-posted.

## 5. Migration/deploy safety (§14) — cross-posted from pc-HUM-63 (dedup)

`check-migrations.js` — 69/69 invariants hold @ backend `3c1881f` (PR #21).
