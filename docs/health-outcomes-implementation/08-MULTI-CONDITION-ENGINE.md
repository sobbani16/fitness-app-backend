# 08 — Multi-Condition Engine (Phase 7)

**Status:** ENGINEERING_COMPLETE

## `services/health/engine.js` — `resolvePlan(userId, {purpose})`
Single deterministic precedence cascade:
- P1 urgent symptoms → `URGENT_ESCALATION` short-circuit
- P2 allergies/restrictions (hard exclusions)
- P3 medication safety flags (catalog-class-derived only)
- P4 life-stage (pregnancy/postpartum/under-18 — explicit fields only, never inferred)
- P6 approved+activated condition rules via `liveRuleWhere`
- P9 preferences last

## Outcomes
- `RESOLVED` — no conflicts
- `EDUCATION_ONLY` — conditions recorded but no approved rules (honest, not invented guidance)
- `PERSONALIZATION_REQUIRED` — opposing live rules (e.g. LIMIT vs PRIORITIZE same attribute) → `UserClinicalReview` row opened; never a guessed compromise
- `URGENT_ESCALATION`

Every plan carries `explainability{why, conditionsApplied, evidenceRefs, missingData, reconsiderAt}` and persists to `SafetyAuditLog` (`checkType: health_plan`).

## Endpoint
`GET /me/health-conditions/plan` (same `health_conditions` flag)

## Evidence
6 engine tests: RESOLVED/EDUCATION_ONLY/URGENT_ESCALATION/PERSONALIZATION_REQUIRED/med-flags/HTTP path — pass
