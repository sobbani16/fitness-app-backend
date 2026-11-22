# CLINICAL_RELEASE_GATES — per-feature, per-country activation design

**Principle:** every clinically-adjacent feature ships dark behind a server-side flag, activates per-cohort, and rolls back by flag-off (no deploy). Gates compose: `flag ∧ consent ∧ country-allowed ∧ rules-approved ∧ reviewer-signed`.

## Gate matrix

| Feature | Flag (existing/new) | Default | Cohort | Country | Additional gate | Rollback |
|---|---|---|---|---|---|---|
| Score v2 route | `health_score_v2` | OFF | founder→alpha | US+IN (wellness) | consent n/a (non-medical) | flag off; v1 unaffected |
| Score v2.1 math | — (bump `dps-v2.1`) | active-in-flag | — | — | snapshot `scoreVersion` preserves old reproducibility | code revert; old snapshots still decode by version |
| Condition nutrient rules | `condition_rules` (new, propose) | OFF | internal only | per-country approval | rule must be APPROVED w/ evidence | flag off (rules already inert) |
| Allergen `safety_warning` | `allergen_warnings` (new) | OFF | founder | both | composition-model coverage threshold + wording sign-off | flag off → falls back to REVIEW |
| Life-stage blocks | none needed — safety posture | ON | all | both | — | n/a (keep on) |
| Calorie floor (G4) | `calorie_floor_policy` (new) | OFF | internal | both | clinical sign-off on thresholds | flag off → `calorieFloor:null` |
| Medication interaction | `medication_interaction` | OFF | internal | both | pharmacist content review | flag off → REVIEW path remains |
| Supplement cautions | `supplement_safety` | OFF | internal | both | 47 DRAFT rule reviews | flag off |
| Scenario engine | `scenario_engine` (exists) | OFF | internal | both | fixture coverage ≥P0 all-executed | flag off |

## Gate enforcement requirements

1. Server-side only — client must never gate safety logic; `requireFeature` returns 403/FEATURE_DISABLED.
2. Audit trail: flag evaluation + outcome logged per request class (who/when/flag/version) — extends existing `FeatureFlagOverride`/audit tables.
3. Kill switch: single flag-off must disable an entire pathway including nested consumers (rule-loading already fail-closed).
4. Rollback plan per feature: flag revert only; no data migration needed since all writes are additive (snapshots carry `scoreVersion`).
5. Country gating: `User.country`/`residency` needed — **not currently modeled**; add field + gate (India: pending CDSCO/DPDP counsel; US: state-law notices).
6. Safe default = OFF for anything touching condition-specific advice.

## Current verdict per feature (engineering view — see report end for GO decisions)

- Score v2.1 (non-medical adherence): engineering-verified; keep flag OFF until fixture coverage + copy review.
- Allergen warnings: engineering partial — composition model thin; keep OFF.
- Condition rules: OFF until approvals exist (0 today).
- Calorie floor: OFF (module inert).
- Medication content: OFF (no content exists — REVIEW path only).
