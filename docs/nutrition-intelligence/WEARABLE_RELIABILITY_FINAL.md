# WEARABLE RELIABILITY — FINAL AUDIT (H6)

Scope: Apple Health + Android Health Connect ingest → dedupe → daily energy summary → calorie-target interplay. Verified against code, not claims.

## Pipeline verified

| Stage | Location | Behavior |
|---|---|---|
| Ingest | `src/routes/healthData.js` POST /energy | Provider whitelist, `sourceId` required, `startAt < endAt`, finite kcal. Idempotent upsert on `(userId, provider, sourceId)` — repeated syncs dedupe by construction. |
| Measurements | `src/services/healthSources.js` | Cross-source workout near-duplicates (same type ±15 min, duration ±3 min) are **marked** `duplicateCheck` in meta — never deleted; consumer dedupes. Per-metric sync cursors. |
| Dedupe | `energySummary.js dedupedKcal` | Union-of-intervals coverage per provider; kcal allocated over each record's original span. Overlapping active-energy windows are never double-counted. |
| Provider selection | `energySummary.js` | Single provider chosen for active energy (max covered minutes, deterministic `PROVIDER_ORDER` tie-break). Resting energy prefers the same provider, else best-covered resting source. Active and resting are never summed from two different sources. |
| Estimates | `energySummary.js` | Missing wearable → `estimate:mifflin_st_jeor` (resting) / `estimate:activity_factor` (active) — always labeled with `source`. Extrapolation only over the covered window. |
| Plausibility | `scenarioCapabilities.validateWearableEnergy` | Caller supplies the bound (e.g., fraction of TDEE). Implausible → flagged, allowance capped at bound, **never inflated**. No hardcoded universal physiological limit is applied to recommendations. |
| Target interplay | `energySummary.js` | Calorie target comes from `macroGoal` (custom/trainer/nutritionist) or TDEE estimate — wearable uncertainty never silently adjusts it. |
| Time zones | `localDayBounds` + `isValidTz` | Local-midnight bounds computed in user tz, DST-safe (23/25h days via elapsed-instant math). Invalid tz falls back to user profile → reminder pref → UTC. |

## Gaps / honest limits

- `dataGaps` reporting exists (`no_active_energy_data`, `partial_wearable_coverage`, `stale_wearable_sync`, `intake_untracked`) — consumers must surface it; mobile rendering of `dataGaps` is partial.
- Intake completeness can never exceed `partial` — completed-day balance is deliberately never claimed (`completedDayKcal: null`).
- The "2.5×BMR" figure cited in earlier specs is **not** hardcoded anywhere; `plausibleMaxKcal` must be supplied by the caller. No universal bound is imposed on users — correct per requirement; the bound config is a reviewer decision.
- Workout near-duplicate marking relies on `meta` pass-through; consumers that ignore `duplicateCheck` may double-display (energy math itself is safe via union dedupe).

## Verdict

Reliability engineering is sound: idempotent ingest, union dedupe, labeled estimates, no silent target adjustment, no universal physiological caps. Remaining work is **presentation** (surface `dataGaps`/`source` in mobile UI) and **reviewer-set plausibility bounds** — not a code defect.
