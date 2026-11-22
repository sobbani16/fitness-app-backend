# FOUNDER_TESTING_PLAN — controlled verification environment

**Environment:** local/dev DB only. No production-user exposure to experimental clinical behavior. Test accounts (`@test.dev` cohort) + synthetic conditions only — never modify real-user profiles.

## Feature flags for founder testing (server-side, fail-closed)

| Flag | Exists? | Capability behind it | Founder-safe? |
|---|---|---|---|
| `health_score_v2` | ✔ live flag | Score v2.1 route (`dps-v2.1` math, flag-verified 403) | YES — adherence score, no clinical claims |
| `scenario_engine` | ✔ (default false) | `ScenarioDefinition` evaluation paths | YES — read-only scenario reporting |
| `allergen_warnings` | ✗ propose | `safety_warning` outcome surfaced in responses | CONDITIONAL — wording review first; safe to demo on synthetic allergens |
| `calorie_floor_policy` | ✗ propose | `evaluateCalorieSafety` output → `calorieFloor` input | CONDITIONAL — threshold sign-off required |
| `condition_rules` | ✗ propose | condition guidance surfacing (rules still inert — DRAFT) | NO user-facing; internal review only |
| `supplement_safety` | ✗ propose | supplement caution content | NO — pharmacist review pending |
| `medication_interaction` | ✗ propose | medication-context content | NO — no content exists by design |
| `food_intel` | ✔ existing | barcode/suitability | YES (already gated) |

## Founder test plan (ordered)

1. **Score v2.1 on synthetic days** — enable `health_score_v2` for founder account only (`FeatureFlagOverride`). Feed curated days: on-target, surplus (expect <40 nutrition), partial log (expect `partial_data`), empty day (`no_data`, composite=0 + state gate), PHO product (quality 0).
2. **Scenario spot-checks** — `scenario_engine` on; run personas P1–P12 from `MEDICAL_VALIDATION_TEST_PLAN.md` against synthetic profiles; verify escalation/review/warning outcomes shown as *internal* annotations only.
3. **Allergy demo (synthetic)** — with `allergen_warnings` on + a synthetic peanut allergy account: confirmed ingredient → `safety_warning`; unknown composition → warning of uncertainty, never "safe".
4. **Decision-engine transparency** — verify every clinical-flavored output routes to review/escalation wording, never advice.

## Hard prohibitions for founder testing

- No real-user conditions/allergies/medications touched.
- No DRAFT rule approval "just to see it work" — the CHECK constraint will refuse silent approval anyway.
- No medication-interaction content, no supplement recommendations, no calorie floor changes.
- Kill-switch check first: toggling the flag off must immediately revert to v1/disabled behavior — verify before each session.

## Evidence to capture

Flag state per request, engine outcome + version (`dps-v2.1`), snapshot rows, and any surprising outputs → append to `FINDINGS`/`EVIDENCE_REGISTER` as QA notes (not clinical validation).
