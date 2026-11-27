# QA Acceptance Report (HUM-P6-018) — self-reported evidence pending independent verification

Punitha independently verifies; this report only assembles revision-linked
evidence for QA consumption. Nothing here is merge evidence by itself.

| increment | revision | self-reported result | independent QA |
|-----------|----------|----------------------|----------------|
| contract manifest + drift guard | `1c432fe` | 3/3 contract tests | pending |
| release mechanics guards | `3c1881f` | 11/11 (8 fixture + 3 contract) | pending |
| security event logging | `268f08cd` (PR #19) | 102/102 × 5 suites | pending |
| DevSecOps P07/P08 | `89c70d2c` (PR #18) | CI jest green at head | pending |

Methodology notes for QA:
- every cited test count was produced by the repository's installed jest runner
  with --runInBand at the cited revision
- red-first evidence exists for pc-HUM-108/143/165 increments (failing test
  precedes fix in each branch's history)
- live-environment evidence (staging smoke 6/6, perf p50 110-135ms) was gathered
  read-only against the staging deployment; production access never used


## 2026-11-26 — weekly-plan allergy-confirmation contract milestone (pc-HUM-63 continuation)

**Evidence commit**: this commit. **Harness**: `tests/contracts/weeklyPlanConfirm.contract.test.js` — 12/12, real route + real allergy engine, controlled data layer.

### Revision pins (rationale)
- backend candidate `b55269a` — branch HEAD after founder main-merge; current contract: structured ALLERGY_* codes, acknowledgeUnknownAllergens, details spread top-level
- backend baseline `625352c` — HF-0001, first revision with the allergy gate; error shape used `blockedMeals`, no acknowledgment param (FIXTURE-only evidence — static shape assertions, not executed route)
- mobile candidate `c9c0e05` — HUM-34, first mobile revision aware of the 409 contract (read-only git-object inspection; wire format transcribed not invented)
- mobile baseline `8375ebf` — parent of c9c0e05, plain `{planId}` wire, no allergy awareness

### CONTRACT FINDINGS (both verified live in the harness)
1. **FIELD-NAME MISMATCH — user-impacting defect candidate**: mobile c9c0e05 sends `acknowledgeUnknown` in the acknowledgment retry; the backend reads `acknowledgeUnknownAllergens`. The acknowledgment is silently dropped — users with unknown-composition meals can never confirm even after acknowledging. Harness proof: exact mobile wire body still receives 409 and zero mutation occurs (safe-side failure, but the acknowledgment UX is dead). Owner: needs cross-repo fix decision — mobile field rename OR backend dual-accept. Filed as a ledger-recorded defect candidate; no app logic changed in this increment per instructions.
2. **details-shape mismatch — degraded but non-fatal**: backend spreads error details top-level (`conflicts` at root); mobile reads `data?.details?.conflicts` → always falls back to `[]`. Error TYPE reaches the user; conflict detail list never does.
3. Old mobile (`8375ebf` wire) → new backend: clean confirm 200 `{confirmed, allConfirmed}` — backward compatible; allergy 409 fails safe (never confirms) for unaware clients.
4. New mobile parser vs old backend shape (FIXTURE-only): `blockedMeals`-keyed errors degrade gracefully to empty conflict lists — no crash path.
5. Authorization is layered: ownership middleware denies cross-user 403 BEFORE the route (deterministic harness behavior); confirmDay service re-checks ownership beneath it (direct-invocation evidence: throws 'Not authorized', no mutation). Repeat confirm is repeat-safe (no error, no duplicate effect).
6. Authn note: route-level 400-on-missing-userId is defense-in-depth — authenticate middleware rejects anonymous requests first in production semantics.
7. Incident disclosure: two fixture-design faults self-caught during harness construction (empty ingredient list is conservatively unknown BY DOMAIN DESIGN; missing ownership-middleware models produced artifact 500s) — corrected before evidence commit; no app defect implicated in either.

### Manifest regeneration
Founder main-merge brought 23 new routes — drift guard correctly failed; manifest regenerated per documented workflow: 593 endpoints, contract v2/min 1. Additivity guard: trivially passes (first introduction on this branch).

### Remaining QA
Punitha independent verification required. The two contract mismatches need a cross-repo owner decision before either side is changed.


## 2026-11-26 — auth/error/correlation contract milestone (pc-HUM-63 continuation 2)

**Evidence commit**: this commit. **Harness**: `tests/contracts/authCorrelation.contract.test.js` — 12/12, REAL middleware chain (AUTH_TEST_BYPASS disabled — the harness point), real authenticate() against mocked authSession rows, synthetic tokens only.

### Revision pins (rationale)
- backend candidate `4a21ab5` — branch HEAD, tested live
- backend baseline `625352c` — requestContext.js and authenticate.js BYTE-IDENTICAL to candidate (diff-verified): the envelope is invariant across the backend pair
- mobile pair `c9c0e05`/`8375ebf` — src/api/client.ts BYTE-IDENTICAL across the pair (diff-verified): client auth/correlation expectations invariant. Interceptor semantics transcribed as FIXTURE-labeled static assertions only.

### Verified contract (live, real middleware)
1. Valid Bearer → handler reached; server identity authoritative — a hostile x-user-id spoof is overwritten by session identity (proven: spoofed intruder header, request still succeeds as session user).
2. Missing token → 401 AUTH_REQUIRED + correlationId; expired session → 401 same envelope (mobile interceptor purges cache + auto-logout on exactly this); unknown token → 401 no enumeration delta.
3. Cross-user plan with valid session → 403 ownership middleware, state unmutated.
4. Correlation: mobile-format `m-` ids echoed on success AND error (header + body same value); malformed ids replaced with server UUID, never reflected.
5. Stale x-client-contract → 426 CLIENT_UPGRADE_REQUIRED + correlation; current contract passes.
6. EMAIL_NOT_VERIFIED envelope surfaced during fixture construction — the exact 403 code mobile's interceptor handles (documented in client contract); fixture corrected to a verified-email synthetic user.
7. COMPATIBILITY FINDING: because both repos' relevant files are byte-identical across both revision pairs, both upgrade orders are safe-by-construction on the auth/error/correlation axis — no gaps found on this axis. The two weekly-plan mismatches from the prior milestone remain OPEN and are the priority contract defects.

### Remaining owner/QA dependencies
Weekly-plan mismatches still need cross-repo owner decision (open). Punitha independent verification required. Fixture-only items labeled in harness.
