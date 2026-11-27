# Integration Checkpoint (HUM-P6-018)

Checkpoint record for the HUM-P6 integration track. Updated 2026-11-26.

## Checkpoint 1 — contract surface frozen and guarded (backend)

- state: manifest emitted (`contracts/api-contract.json`, 570+ endpoints),
  drift guard in CI (`1c432fe`), additive-evolution guard implemented (`3c1881f`)
- evidence: `tests/contracts/apiContract.test.js` 3/3 at branch head
- contradiction resolution: prior "pending-after-merge" entries in scattered
  progress docs referred to work now verifiable at exact SHAs — this ledger
  supersedes them; anything not cited at a revision here is UNVERIFIED.

## Checkpoint 2 — release mechanics operationalized

- state: three guards implemented and fixture-tested at `3c1881f`
- open: CI wiring of check-release-head (needs a merge-orchestration decision —
  who/what invokes the guard at merge time); serialized-merge runbook unwritten
- deployment safeguard: merge→prod behavior on Railway UNVERIFIED — requires
  dashboard access; until verified, every merge to main must be treated as a
  release operation (per card rule).

## Checkpoint 3 — deep contract shapes

- state: route-level surface only. Req/res field shapes, per-endpoint authz
  matrix, idempotency annotations not yet machine-readable.
- next increment: extend emitter with per-route-file static extraction of
  requireFeature/authenticate presence + httpError literal catalog; authz
  depth from existing docs/security-audit/AUTHORIZATION_MATRIX.md (main).
- old-mobile↔new-backend both-directions: minClientContract/426 path is
  runtime-tested (apiContract.test.js); additive guard covers the other direction.

## Cross-repo dependencies

- mobile consumes `/config/features` + contract headers; hum32/hum53 branches
  carry probe coverage; contract-binding tests (mobile reading the manifest)
  are the consuming increment once this branch merges.
- secrets registry (E2E_STAGING_*, EXPO_TOKEN, PROD_SMOKE_TOKEN) blocks all
  live-E2E evidence across cards — single needs_human ask covers all.


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
