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


## 2026-11-26 — injury PATCH contract milestone (pc-HUM-63 continuation 3)

**Evidence commit**: this commit. **Harness**: `tests/contracts/injuryPatch.contract.test.js` — 14/14, real route + real middleware (bypass disabled), synthetic identities. Combined battery 49/49 across 5 suites.

### Revision pins (rationale)
- backend candidate `5e2f3ef` — branch HEAD, tested live
- backend baseline `625352c` — injury PATCH exists but granular validation envelope is a candidate-side ADDITIVE expansion (static diff evidence, fixture-labeled)
- mobile candidate `f184c99` — humai/dev-02/pc-HUM-43-injury-ux tip (read-only git objects only — dev-02 branch untouched)
- mobile baseline `846a88a` — mobile origin/main; updateInjury wire surface identical in both revisions

### Verified live
Method/path/response `{updated:true}`; editable-fields allowlist (unsupported_fields 400 with field enumeration, zero mutation); per-field invalid_field 400s (status/laterality/painLevel bounds/clearance-pair); no_editable_fields 400; cross-user 404 no-existence-leak; missing token 401 envelope; object-level authz in the write itself (`where: {id, userId}`); clinician-documented 409 clinician_fields_locked with non-locked edits still accepted; status=resolved server-side resolvedAt set/cleared; repeat-patch repeat-safe.

### CONTRACT DEFECT recorded (app logic unchanged per instructions)
**painLevel null-corruption**: mobile types painLevel as `number | null` (null = cleared/unrecorded); backend validation explicitly exempts null but `num(null)` coerces to 0 — the write persists pain-level-ZERO, collapsing semantically distinct states. Harness documents actual behavior with the defect annotation. Release-order dependency: backend fix can ship independently (old mobile never relies on reading back null); fix decision belongs to the route owner.

### Compatibility findings (fixture-labeled)
- old mobile wire keys ⊆ candidate INJURY_EDITABLE — forward compatible, no old-client payload rejected as unsupported.
- baseline error envelope ⊆ candidate envelope — additive validation expansion, no breaking change for well-formed clients in either upgrade order.
- weekly-plan findings from prior milestones remain OPEN.


## 2026-11-26 — symptom submission contract milestone (pc-HUM-63 continuation 4)

**Evidence commit**: this commit. **Harness**: `tests/contracts/symptomSubmit.contract.test.js` — 12/12, real route + real middleware (bypass disabled), synthetic tokens. Combined battery 61/61 across 6 suites.

### Revision pins (rationale)
- backend candidate `ea17bac` — branch HEAD, tested live
- backend baseline `625352c` — response keys present at baseline (static extraction, fixture-labeled): envelope stable across the pair
- mobile pair `f184c99`/`846a88a` — reportSymptoms caller BYTE-IDENTICAL (diff-verified): one wire format serves both generations

### Verified live
Mobile wire format → 201 with full response shape (reportId/disposition/message/suppressesActivitySuggestions/urgentSymptoms/noDiagnosis); required symptoms array enforced with zero persistence on rejection; code normalization (lowercase/trim/blanks dropped); optional-field defaults (severity null, context unspecified, source manual); urgent-symptom escalation path (disposition/echoed codes/emergency copy); session-only identity (body userId ignored); 401 envelope on missing token with zero persistence.

### Contract observations recorded (app logic unchanged)
1. **Lenient coercion asymmetry**: unlike injury PATCH strictness, invalid severity/context/persistence do NOT reject — they silently coerce to null/unspecified. Well-formed mobile clients unaffected in either upgrade order; documented as API-surface asymmetry for the contract owner. No user harm path identified (values were invalid input).
2. **No idempotency on POST /symptoms**: repeat submission creates duplicate rows — no dedupe key exists. Honest retry-behavior documentation: client retry/offline-sync duplicates persist. Recorded as a contract gap candidate adjacent to the offline-queue milestone (LEO-056..058). Owning component: backend route; release-order: backend can add idempotency independently (additive, old clients unaffected).
3. Symptom codes are free-form strings — no closed-enum validation of the codes themselves beyond urgent-set membership. Noted for the registry-owner.

### Compatibility findings
Both upgrade orders safe-by-construction on this axis: caller byte-identical across mobile pair, response envelope stable across backend pair. Fixture-labeled where static.

### Open findings register (unchanged)
weekly-plan acknowledgeUnknown mismatch; weekly-plan details-shape mismatch; injury painLevel null-corruption — all still open pending cross-repo owner decisions. Punitha independent QA due on all milestones.


## 2026-11-26 — safety evaluation contract milestone (pc-HUM-63 continuation 5)

**Evidence commit**: this commit. **Harness**: `tests/contracts/safetyEval.contract.test.js` — 11/11, real route + real middleware + real deterministic safety engine, synthetic tokens/fixtures. Battery: 64/64 in tests/contracts, 11/11 apiContract+releaseMechanics.

### Revision pins
- backend candidate `e8d47de` — branch HEAD, tested live
- backend baseline `625352c` — evaluate route present, same method/path family (fixture-labeled static)
- mobile pair `f184c99`/`846a88a` — evaluateActivity caller wire keys identical (activityId/lat/lon)

### Verified live + the milestone's central finding
1. **Unavailable-vs-clearance distinction is structural, not conventional**: incomplete/empty safety profile evaluates to `INSUFFICIENT_DATA` — NEVER ALLOW. The conservative default is engine-enforced. Mobile's ActivityDecision type (transcribed, byte-identical across the pair) names all 7 decisions including INSUFFICIENT_DATA — the distinction survives the wire; the consumer cannot collapse unavailability into clearance by type widening.
2. Restriction path verified: non-weight-bearing knee injury blocks strength training (BLOCK_ACTIVITY/MODIFY/NEEDS_CLINICAL_REVIEW — never ALLOW). Urgent symptom fixture suppresses clearance.
3. Wire contract: mobile format {activityId, lat, lon} → 200 {decision, reasons[], noMedicalClaims:true}; unknown/missing activityId → 400; lat/lon optional; 401 envelope; errors are 500-envelope — the backend never synthesizes ALLOW on failure.
4. Activity catalog keys are namespaced (`outdoor_walk` not `walking`) — fixture correction during harness construction disclosed in ledger; mobile consumers use catalog-provided ids so no cross-repo key mismatch exists (verified via mobile caller usage pattern).
5. Both upgrade orders compatible: wire keys + decision enum stable across both pairs (fixture-labeled where static).

### Open findings register (unchanged)
weekly-plan acknowledgeUnknown mismatch; weekly-plan details-shape mismatch; injury painLevel null-corruption — still open pending owner decisions. Punitha independent QA due on all five milestones.


## 2026-11-26 — safety recommendation contract milestone (pc-HUM-63 continuation 6)

**Evidence commit**: this commit. **Harness**: `tests/contracts/safetyRecommend.contract.test.js` — 10/10, real route + real feature gate + real recommend pipeline, synthetic tokens/fixtures. Battery: 74/74 in tests/contracts.

### Revision pins
- backend candidate `96ed02a` — branch HEAD, tested live; merge `df477ee` referenced as gate-evidence pin (fixture-labeled static)
- backend baseline `625352c` — recommendation route present on lineage (fixture-labeled static)
- mobile pair `f184c99`/`846a88a` — getSafetyRecommendation caller + SafetyRecommendation type transcribed from git objects; wire identical across pair

### Verified live
1. Response shape keys exact: disposition/policyVersion/suggestion/requiredData/activities/noMedicalClaims; disposition within mobile's 5-member enum; per-candidate rows carry activityId/decision/suppressed/reasons.
2. **Safety-critical invariants proven**: restricted user never receives a blocked activity as suggestion (per-candidate BLOCK rows are correct surfacing, never recommended); urgent symptom suppresses everything (suggestion null, suppressed-family disposition); no activityId spoofing (query ignored, session-scoped context only).
3. **Documented nuance — incomplete-profile semantics**: recommendation pipeline yields indoor_walk ALLOW (empty reasons) — data-independent benign activity — while data-dependent candidates still evaluate INSUFFICIENT_DATA per-row. Contrast with evaluate milestone's outdoor_walk INSUFFICIENT_DATA is activity-dependence, not contradiction. Flagged for engine-owner confirmation; not asserted as defect.
4. 401 AUTH_REQUIRED envelope on missing token. Feature gate health_aware_recommendations in chain.
5. Compatibility: mobile wire (lat/lon query only) ⊆ route-consumed keys; mobile-consumed response keys ⊆ route-produced — additive extras (restFallback/environment) ignored by axios pass-through. Both upgrade orders safe (fixture-labeled static evidence marked).

### Open findings register (unchanged)
weekly-plan acknowledgeUnknown + details-shape mismatches; injury painLevel null-corruption; symptom no-idempotency retry gap. Punitha independent QA now due across six milestones.
