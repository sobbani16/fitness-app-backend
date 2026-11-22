# WEARABLE_ENERGY_VALIDATION — validateWearableEnergy integration audit

**Consumer:** `GET /progress` expenditure path (`routes/progress.js`). Field semantics: `healthEnergyRecord.activeKcal` = provider *active* energy (device-reported, excludes basal); `restingKcal` separate — never summed into active. Per-day single best-coverage provider via `dedupedKcal` (overlaps counted once).

**Bound:** `plausibleMaxKcal = 2.5 × BMR estimate` — explicitly an *engineering* plausibility bound (in-code comment + `source:'wearable_capped_implausible'` label), NOT a physiological maximum. Implausible readings are capped at the bound AND labeled — original values are not deleted (records are read-only here; capping applies at aggregation). No bound → `no_data` state.

**Honesty gaps remaining:** (1) `WorkoutSession.source`-level dedupe across manual+wearable channels still relies on ingest-time `meta.possibleDuplicate` flags — a consumer-side dedupe pass is future work; (2) unit validation (kJ vs kcal) is provider-field-defined, not independently verified per record; (3) TDEE-vs-active semantics rely on provider definitions documented in `healthSources` PRECEDENCE. None fabricate data.
