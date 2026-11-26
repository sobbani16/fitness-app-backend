# 04 — Medication Safety (F-C3)

**Status:** ENGINEERING_COMPLETE (framework) · COVERAGE LIMITED · **Flag:** `user_medications`

## Design
- `Medication` (shared catalog: normalized name, class, optional RxCUI) + `UserMedication` (dose text/value/unit, schedule, dates, active, source, consent, lastConfirmedAt)
- `medicationCatalog.js`: deterministic curated alias map → coarse classes (insulin, sulfonylurea, diuretic, anticoagulant, potassium-affecting, exercise-intolerance). **Unclassified stays unclassified — no guessing.**
- Safety flags derive ONLY from explicit catalog class: `hypoglycemia_risk`, `vitamin_k_consistency`, `potassium_monitoring`, `hydration_electrolyte`, `exercise_symptom_risk`
- No prescribing, no dose changes, no interaction claims

## API
`GET/POST/PATCH/DELETE /me/medications` + `POST /me/medications/:id/confirm` (staleness refresh; >90d flagged in plan `missingData`)

## Mobile
`MedicationsScreen` — add (name+dose text, consent), list w/ classified/unclassified badge, confirm-current, remove. Required disclaimer rendered.

## Evidence
- Tests: classification/unclassified/staleness/cross-user isolation/deactivation — pass
- Deletion coverage: `userMedication` in accountData OWNED

## Blockers
- No authoritative drug reference (RxNorm/DrugBank) licensed — class coverage is the curated set only; expanded coverage BLOCKED on data source + clinical review
