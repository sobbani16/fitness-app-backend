# MEDICAL_LAUNCH_ROADMAP — prioritized implementation plan

**Order = safety dependencies, not feature value.** Each step lists blocker + owner. Nothing here activates medical functionality without the named review.

| # | Work | Depends on | Owner | Status |
|---|---|---|---|---|
| 1 | ~~Fix A06/HF-0020~~ energy+range scoring `dps-v2.1` | — | eng | **DONE** (fixture green) |
| 2 | ~~Allergen `safety_warning` outcome + persistent-symptom triggers~~ | — | eng | **DONE** |
| 3 | Fixture authoring for remaining 64 blocked scenarios (each needs capability design first) | per-capability | eng | next |
| 4 | Goal-switch flow (A10): GoalHistory + confirm + recalc | D1 taxonomy ✔ | eng | spec exists |
| 5 | Wearable dedup/implausibility (F09/K09): validation layer before activity/calorie inputs | eng design | eng | blocked-capability |
| 6 | Raw↔cooked conversion (K04) + serving recalc (K05) | nutrient normalizer | eng | blocked-capability |
| 7 | Duplicate log detection (K08) | barcode+photo identity | eng | blocked-capability |
| 8 | Outcome monitors (L01–L10, A09): multi-week trend layer | data pipeline | eng | blocked-capability |
| 9 | Allergen composition model + cross-contact lexicon | allergist review | data + clinical | prerequisite for I07 warnings to mean anything |
| 10 | G4 calorie-floor activation | dietitian sign-off on proposed floors | clinical | `calorieSafety.js` inert |
| 11 | Clinical rule review program (14+3+31+47 rows) | reviewer roster | clinical | queue: `CLINICAL_RULE_APPROVAL_MATRIX.md` |
| 12 | Consent + privacy controls (granular consent, trainer scope audit, retention/deletion, India DPDP notice) | counsel | eng + legal | `HEALTH_DATA_PRIVACY_AUDIT.md` |
| 13 | Country gate field + per-country feature map | 12 | eng | — |
| 14 | External regulatory review: CDS/wellness boundary (US), CDSCO/FSSAI/DPDP (India) | counsel | legal | `US_INDIA_REGULATORY_REVIEW.md` |
| 15 | Cohort release: founder → internal → small external cohort per feature per country | 1–14 | product | gated |

## Explicit non-goals this phase

- No rule approvals without named reviewers.
- No medication-interaction content.
- No universal calorie minimum.
- No global v2 enablement.

## Engineering-only queue (safe to proceed)

- A10 goal switching, K05 serving recalc, F09/K09 wearable validation layer, L-family trend monitors, test isolation fixes, allergen composition data model (schema, not rules).
