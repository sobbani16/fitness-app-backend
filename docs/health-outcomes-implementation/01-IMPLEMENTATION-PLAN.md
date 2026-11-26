# 01 — Implementation Plan

**Order of execution** (dependency-driven):

| Item | ID | Deps | Status |
|---|---|---|---|
| Workspace + tracker | IMPL-00 | — | DONE |
| Schema v1: UserHealthCondition fields, Medication, UserMedication, ClinicalMeasurement, rule-activation columns, enum extension | IMPL-01 | — | in progress |
| Feature flags: `health_conditions`, `user_medications`, `clinical_measurements`, `clinical_rule_admin` | IMPL-02 | — | pending |
| Migration (additive SQL + resolve) | IMPL-03 | IMPL-01 | pending |
| `/me/health-conditions` API + condition catalog/registry | IMPL-04 | 1–3 | pending |
| `/me/medications` API + med-safety flag derivation | IMPL-05 | 1–3 | pending |
| `/me/clinical-measurements` API + validation | IMPL-06 | 1–3 | pending |
| accountData OWNED coverage + test | IMPL-07 | 1–3 | pending |
| F-R1: generateFoodSuggestions conditions fix + regression tests | IMPL-08 | — | pending |
| Rule governance: lifecycle service + super-admin endpoints + activation audit | IMPL-09 | 1–3 | pending |
| Mobile: HealthConditions, Medications, Measurements screens | IMPL-10 | 4–6 | pending |
| Multi-condition resolver `health/engine` | IMPL-11 | 4–6,9 | pending |
| 90-day journey skeleton | IMPL-12 | 11 | pending |
| Test matrix execution | IMPL-13 | all | pending |
| Staging validation | IMPL-14 | 13 | BLOCKED (staging access unverified) |
| Final report | IMPL-15 | all | pending |

**Feature-flag strategy:** every new surface behind a server-class flag, default `false`, failOpen `false`. Rollout: env allowlist → PostHog cohort.

**Rollback:** flags off → new routes 404; additive tables unused; no destructive reversal needed.
