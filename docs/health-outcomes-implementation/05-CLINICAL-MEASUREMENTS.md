# 05 — Clinical Measurements (F-C4)

**Status:** ENGINEERING_COMPLETE (manual entry) · **Flag:** `clinical_measurements`

## Model
`ClinicalMeasurement`: metric, value, valueSecondary (BP diastolic etc.), unit, measuredAt, source (`user_entry|device|lab_report|clinician`), method, quality, verified, correctionOfId (supersession), meta

`measurementRegistry.js` METRICS: weight, waist, blood_pressure, hba1c, fasting_glucose, ldl, hdl, triglycerides, total_cholesterol, alt, ast, egfr, uric_acid, tsh, phq9, gad7, isi, psqi — each with unit allowlist + plausible-range validation; suspicious values rejected with 422 (never silently coerced)

## API
`GET/POST /me/clinical-measurements`, `POST /:id/correct` (creates superseding row — originals preserved), `DELETE /:id`

## Mobile
`MeasurementsScreen` — metric chips, BP two-field entry, source segmented, history w/ Correct/Remove, provenance labels, disclaimer

## Safety guarantees
- Stored verbatim; provenance labeled; corrections append-only
- No diagnostic interpretation anywhere — disclaimer states it

## Evidence
- Tests: validation rejections, provenance, correction/supersession, cross-user isolation — pass
- Deletion coverage: `clinicalMeasurement` in OWNED

## Blockers
- Device/lab import integrations not implemented (manual entry + future authorized sources only)
