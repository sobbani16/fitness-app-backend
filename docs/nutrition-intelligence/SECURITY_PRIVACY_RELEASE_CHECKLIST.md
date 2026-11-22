# Security & Privacy Release Checklist

| Control | Status | Evidence |
|---|---|---|
| AuthZ: nutrition review | `NUTRITION_DATA_REVIEW` RBAC; member→403, unauth→401 | tests/nutritionReview.test.js 8/8 |
| AuthZ: trainer access | Consent-scoped; revocation hides sections | e2eTrainerJourney (green latest) |
| Symptom ownership | create/read/update/delete owner-scoped; cross-user 404 | asyncScenarios.api 7/7 |
| Clinical rule approvals | ACADEMY_CLINICAL_REVIEW separate; no approvals exist | rbac.js, CLINICAL_REVIEW_HANDOFF |
| Consent/revocation | consent-filtered trainer progress verified | e2eTrainerJourney step 6/12 |
| Unverified data | verifiedAt NULL invisible to consumers (fail-closed) | proven via route+DB E2E |
| Secrets | none in logs/docs; key presence only | grep-clean |
| Test isolation | fitness_test + fitness_auth_readiness only; URL guard in setup.js | tests/setup.js |
| Flag bypass resistance | server-side requireFeature; env overrides honored only in test bypass | featureFlags suite |
| Destructive ops | rollback verified synthetic-only; no production writes | USDA_PREVIEW_PREFLIGHT |
| Audit trail | AuditLog on review decisions; immutable | nutritionReview route |

## Counsel questions (US/India) — unchanged: HIPAA applicability for trainer-held symptom data; FDA general-wellness boundary for safety suggestions; CDSCO classification; FSSAI claims; DPDP consent/deletion/child data; cross-border processing; breach notification; consumer-health-data acts (WA My Health My Data etc.).
