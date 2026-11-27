# Weather wind thresholds — evidence and product-policy status

**Status: product heuristics, NOT clinically approved. Clinical approval
requirements are fully preserved — these thresholds must not be represented
as clinically validated, and the clinical-review gate for health-rules
remains intact (zero APPROVED clinical rules until clinician signoff).**

Date: 2026-11-27 · Scope: backend `activitySafety/environment.js`, mobile
`services/weatherContext.ts`.

## Thresholds in force

| Where | Threshold | Effect | Evidence basis |
|---|---|---|---|
| mobile `weatherContext.ts` `WINDY_KMH` | sustained ≥ 30 km/h | comfort-level "consider indoor alternative" | Beaufort scale: ~29 km/h sustained ≈ force 5 ("fresh breeze") — small trees sway, walking against it takes effort. Comfort heuristic, not a safety claim. |
| mobile `weatherContext.ts` `GUSTY_KMH` | gusts ≥ 50 km/h | same comfort-level message | Beaufort: ~50 km/h gusts ≈ force 7 ("near gale") — balance/debris become a concern for the general population. |
| backend engine `HIGH_WIND` hazard | gusts ≥ 50 km/h | MODIFY outdoor activities | Same Beaufort force-7 basis, consistent with mobile. |
| backend engine cold branch | sustained ≥ 20 or gusts ≥ 30 km/h, only when apparent ≤ −7 °C | COLD_CAUTION (MODIFY) | Wind-chill exposure amplification in freezing conditions; conservative lower bound. |

## Deliberate properties

1. **Missing wind data never claims safety.** `normalizeWind` maps explicit
   null/undefined/missing/empty/invalid/negative provider values to null
   (unavailable). Null wind raises no wind hazard AND produces no positive
   comfort/safety message — mobile suppresses activity encouragement entirely
   when wind is unmeasured.
2. **Legitimate measured 0 km/h is preserved** as real information (dead calm),
   distinct from unavailable.
3. **Asymmetry is intentional**: mobile 30/50 is a *comfort* layer for all
   users; the backend engine's hazard layer (injury/medical-aware) is the
   safety authority. When the health-aware flag is active, the engine owns
   activity suggestions exclusively — the mobile fallback cannot fire.
4. **Not clinically validated.** Beaufort is a maritime/obervational scale;
   application to exercise safety for clinical populations (balance
   impairment, osteoporosis fall risk, respiratory conditions) requires
   clinician review before any strengthening of these thresholds or their
   consequences. The 20/30 cold-branch values are conservative product
   choices pending that review.

## Clinical approval requirements (preserved)

- These thresholds MAY be weakened/messaged as product comfort guidance only.
- Any claim of clinical validity, any clinical-population-specific threshold,
  and any blocking (rather than modifying) consequence for medical profiles
  requires the existing clinical approval path — unchanged by this document.
