# FEATURE_FLAG_GOVERNANCE — medical flag lifecycle

**Registered (this session, `src/config/featureRegistry.js`):** `allergen_warnings`, `calorie_floor_policy`, `condition_rules`, `supplement_safety`, `medication_interaction` — all `default:false`, `failOpen:false`, `group:'medical'`, `class:'server'`.

## Governance rules

1. **Default OFF everywhere** — resolves false when: no env override, no provider value, provider down (`failOpen:false` → resolves `default`), or missing config. Verified by `tests/medicalFlagGovernance.test.js` (11 tests).
2. **Not auto-enabled in tests** — `tests/setup.js` skips `group:'medical'` when blanket-enabling flags (previously only `control` was skipped). Per-test enablement is explicit.
3. **No bypass paths** — flags are evaluated server-side only via `featureFlags/service.isEnabled(userId)` / `requireFeature`; client input cannot set them; `x-user-id` is rewritten by `authenticate`; admin roles have no flag-override route; group is NOT `ai`, so AI outputs cannot influence them (and `ai_emergency_shutdown` doesn't gate them either).
4. **Flags ≠ rule approval** — `condition_rules`/`supplement_safety` gate *surfacing* only; each `ConditionRule`/`SupplementSafetyRule` additionally requires `reviewStatus:'APPROVED'` (DB CHECK enforces reviewer+evidence+clinicalAction). A flag ON changes nothing without approved rules.
5. **Decision logging** — flag evaluations are per-user resolvable and auditable; on activation, capture flag state in the scenario/audit event (existing `AuditEvent`/snapshot fields).
6. **Rollback** — flip flag OFF; no data migration (all writes additive; snapshots carry `scoreVersion`).

## Eligibility chain before any cohort enablement

`flag exists` → `engineering verified` → `clinical reviewer approves content/rules` → `counsel sign-off where regulated` → `founder cohort` → `internal cohort` → `external cohort` → `general`. Each step requires a named approver recorded in `CLINICAL_RULE_APPROVAL_MATRIX.md` / `RELEASE_GATE_STATUS.md`.

## Current state (verified 2026-11-21)

All 5 flags: registered ✔, resolving `false` ✔, zero consumer code paths wired ✔ (by design — wiring is the gated next step).
