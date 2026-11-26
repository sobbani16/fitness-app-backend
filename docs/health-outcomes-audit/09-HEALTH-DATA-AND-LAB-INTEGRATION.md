# 09 — Health Data & Lab Integration

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22

## 1. What exists

| Capability | Status | Detail |
|---|---|---|
| Wearable energy | WORKS | `POST /health-data/energy` — provider∈{fitbit,healthkit,health_connect}, idempotent upsert `(userId,provider,sourceId)`, bounds 0–20000 kcal, 200-record batches; flag-gated |
| HealthMeasurement | Schema-ready | metric∈{heart_rate,resting_heart_rate,hrv_sdnn,hrv_rmssd,steps,sleep,active_energy,resting_energy,workout}; `quality` + `synthetic` + `meta` provenance fields — well designed |
| Sync cursors | Schema-ready | HealthSyncCursor per (source,metric) w/ retry/error fields |
| Data sources | Schema-ready | HealthDataSource + WearableDevice + user consent pattern |
| Steps/sleep | WORKS | DailySteps 42 rows, SleepLog 42 rows; mobile `stepsSync` service + tests |
| Weight | WORKS | WeightEntry 24 rows; `POST /me/profile/weight` explicit-measurement path |

## 2. What is missing for outcomes (Phase 6)

| Required | State |
|---|---|
| Lab values (HbA1c, fasting glucose, lipids, ALT/AST, eGFR/creatinine, uric acid, TSH, B12, ferritin, hs-CRP, vitamin D) | **NO MODEL** — no table, no API, no units registry |
| Blood pressure | **MISSING** — no BP metric in HealthMeasurement enum |
| Waist circumference | **MISSING** — only weight |
| Validated questionnaires (PHQ-9, GAD-7, ISI, PSQI, KOOS/WOMAC, ASES) | **MISSING** — wellness check-ins are freeform |
| Measurement provenance for labs | Partially modeled (provider/externalId/quality/meta pattern) — reusable for labs |
| Medication changes alongside measures | **MISSING** |
| Clinician-reviewed flag on measurements | **MISSING** |

## 3. Fit-for-purpose notes

- `HealthMeasurement.synthetic` flag for simulator records — exactly the provenance discipline the outcomes system needs; reuse this model shape for `ClinicalMeasurement`.
- No path infers disease state from wearable data — verified (metrics are activity/recovery only). Keep it that way.
- External-ID idempotent upsert pattern is the right ingest contract for HealthKit/Health Connect lab records (HKClinicalRecord / FHIR) later.

## 4. Verdict

Wearable ingest: **PASS (flag-gated)**. Clinical/lab integration: **MISSING — BLOCKED for 40-condition outcomes** (cannot track HbA1c→remission, lipids→risk, eGFR→CKD staging, BP→HTN control without it).
