# 07 — Clinical Rule Governance (F-C2)

**Status:** ENGINEERING_COMPLETE · **Flag:** `clinical_rule_admin` · **Clinical approval:** BLOCKED (no qualified reviewer — none fabricated)

## Lifecycle
`DRAFT → IN_REVIEW → REVIEWED → APPROVED → (activate) → RETIRED` + `REJECTED`; invalid transitions → 409

## Contract
- Approval ≠ activation: `isRuleLive` = APPROVED + activeAt ≤ now + unexpired + unretired
- All six rule consumers gated via `liveRuleWhere`/`isRuleLive` — DRAFTs provably inert
- Separation of duties: `clinical_rule.review` (CLINICAL_REVIEWER role) vs `clinical_rule.activate` (SUPER_ADMIN); approver cannot activate own approval
- `ClinicalRuleEvent` audit rows: actor, role, from→to, notes, diff, timestamp; `UserClinicalReview` for patient-level escalations
- AI/admin cannot self-approve — reviewer role required; emergency `retire` path disables instantly

## API
`POST /super-admin/clinical-rules/:id/transition {to, notes}` + `GET /super-admin/clinical-rules` (filter by status/table)

## Evidence
- Tests: full lifecycle, invalid transitions, live-gating, approver≠activator — pass
- Fixture tests updated: `APPROVED` fixtures now also set `activeAt` (correct semantics, not weakened)
