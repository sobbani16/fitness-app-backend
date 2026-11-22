# HEALTH_DATA_PRIVACY_AUDIT — consent, access, retention (audit, not legal opinion)

**Scope:** user health data (conditions, allergies, logs, scores, sleep, supplements), trainer/admin access, both jurisdictions (US state laws incl. WA MHMD/CA CMIA; India DPDP 2023).

## Current state (repo-verified)

| Control | Implementation | Gap |
|---|---|---|
| AuthN | global `authenticate` rewrites `x-user-id`; req.userId authoritative | — |
| Feature flags | server-side `requireFeature`/flags service, fail-closed | `scenario_engine` off by default ✔ |
| Clinical rules | DRAFT inert; CHECK constraint on approval metadata | reviewer-identity provenance absent until approvals exist |
| Consent | `UserConsent`/consent fields in schema | **no verified consent flow for health-data processing** — condition personalization has no explicit consent gate |
| Trainer access | `trainerProfile`, `nutritionistProfile`, MealPlan clientId links | **no scoped-permission audit trail found** — verify what members a trainer can read (nutrition data is health data) |
| Logging | `AuditEvent`/audit tables exist | PII/PHI minimization in logs unverified — audit needed before launch |
| Retention/deletion | none found for health data specifically | **no retention policy or deletion job**; test-user report shows residue accumulation |
| Country data | single Postgres (Railway prod snapshot earlier) | **no India-residency/partitioning**; DPDP transfer questions open |

## Requirements before medical launch

1. Explicit, granular consent for processing self-reported conditions/allergies for personalization (separate from ToS); withdrawal must disable personalization + purge derived data.
2. Trainer scope: verify per-field access control (trainer sees only assigned members; conditions/allergies minimized unless required for coaching); add access audit log.
3. Health-data retention/deletion policy + executable deletion (FK-aware, verified) — extends `TEST_USER_CLEANUP_IMPACT.md` procedure to real accounts on request.
4. Log hygiene: no condition/allergen values in application logs; audit event taxonomy for clinical decisions.
5. India: DPDP consent notice, grievance contact, data-principal rights handling; evaluate residency requirement with counsel.
6. US: state health-privacy notices (WA MHMD consumer health data definitions likely apply); no sale/share of health data.
7. Encryption at rest/in transit — verify provider config; secrets in secrets manager only.

**Status: OPEN — several controls are schema-only; not verified operational.**
