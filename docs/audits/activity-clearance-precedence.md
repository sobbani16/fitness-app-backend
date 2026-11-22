# Clearance Precedence Model (Phase 17 §2)

## Explicit order (per activity evaluation)

1. **Urgent symptoms** short-circuit before all rule/dimension evaluation → `URGENT_ESCALATION`. No clearance reaches this path.
2. **Surgery `clinicianRestrictions`** → `BLOCK` (checked before any clearance; a specific prohibition beats every clearance).
3. **`resolveClearance(sx, activityId, now)`** — scoped, dated, specificity-ranked:
   - activity-specific entry > general/`*` scope
   - `restricted` > `cleared` at equal scope
   - `expiresAt <= now` and `effectiveAt > now` records ignored
   - `status` may be a bare map value or `{entries:[…]}` record with `effectiveAt/expiresAt/documentedBy`
   - `cleared` only suppresses *the surgery's own* `NEEDS_CLINICAL_REVIEW`
4. **Documented restrictions** (injuries → `prohibitedCategories`, `UserActivityRestriction`) → `BLOCK`/`MODIFY` — evaluated independently of clearance.
5. **NWB/weight-bearing checks** — independent of clearance.
6. **Dimension merge by restrictiveness rank** — clearance never emits an `ALLOW` that could compete; it only removes a surgery-scoped NCR. Any other dimension's stricter verdict wins by merge.

## Invariants (12 deterministic tests — `tests/activitySafety.clearancePrecedence.test.js`)

- general `cleared` never overrides: newer active NWB injury → BLOCK; active clinician restriction → BLOCK; same-surgery `clinicianRestrictions` → BLOCK; urgent symptom → URGENT_ESCALATION; environmental hazard → non-ALLOW.
- specific `restricted` beats general `cleared`.
- specific `cleared` never clears an unrelated restriction.
- expired/not-yet-effective clearance → treated absent (NCR resumes).
- provenance: `{status, scope, effectiveAt, expiresAt}` surfaced on `dimensions.functional.clearances` — reviewers see *which* record satisfied clearance.

## Honest limits

- A clearance record asserts nothing about other conditions — a `cleared` walk is still reviewed if a separate unresolved surgery or injury applies.
- `documentedBy` is stored metadata only; credential verification of the recording clinician is an operations task, not engine behavior.
- `general`/`'*'` clearance should be reserved for true "cleared for all activity" documentation — API/docs note this.
