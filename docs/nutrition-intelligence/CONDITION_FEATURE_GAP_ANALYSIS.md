# CONDITION_FEATURE_GAP_ANALYSIS — per condition, per spec

**Sources:** Appendix A I-domain + distributed scenarios, fixture results, `verify-rule-gating.js`. "Rule coverage" = authored rules (all DRAFT/inert); "Behavior coverage" = executable engine paths.

| Condition | Scenarios | Rules (all DRAFT) | Executable behavior today | Gaps |
|---|---|---|---|---|
| T1D/T2D | I01 I02 I03 (+B03) | 4 nutrient DRAFTs | escalation on insulin-carb & hypoglycemia | no approved rules; no medication-context model; no glucose data source |
| Prediabetes | I03-ish | 1 DRAFT | none beyond generic sugar moderation | threshold TBD |
| Hypertension | I06 | 1 DRAFT (sodium) | sodium moderation part (population-agnostic) | no BP reading integration; DASH guidance not authored |
| Dyslipidemia | I03 I04 | 3 DRAFTs | saturated-fat moderation part | no lipid panel data; personalization absent |
| CKD | I05 (+D07 potassium) | 2 DRAFTs (K⁺/PO₄) | `ckd_protein_target` → review | stage-specific rules; eGFR data absent |
| CVD | — | none | none | **no scenario or rule coverage** — needs spec + clinical input |
| Thyroid | I09 | 2 DRAFTs + supplement cautions | none | medication timing (levothyroxine-food) = review content |
| PCOS | I09 | none | none | guidance-only; avoid causal claims |
| Pregnancy | J06 (+I08 partial) | PREGNANCY_CAUTION DRAFTs | life-stage block (tested) | trimester model; food-safety list (listeria etc.) unbuilt |
| Lactation | J07 | none | life-stage block | energy needs + safety lists unbuilt |
| Allergies | I07 | allergen rules DRAFTs | `safety_warning` outcome (new) | no ingredient-composition model; cross-contact lexicon unverified |
| Celiac | I08 | gluten DRAFT | `safety_warning` outcome | cross-contact/gf-certification data absent |
| Under-18 | J08 | — | life-stage block | onboarding is 18+; enforce age gate at API too |
| Older adult | J09 | — | review trigger | sarcopenia/frailty model absent |
| Eating-disorder risk | J10, E07, E08 | — | review trigger | suppression-of-numbers UX unbuilt |
| Multi-condition conflict | I10 | — | `conflicting_conditions` → review | rule-conflict resolver absent |
| Medication-food | J04, J05, I01 | — | review trigger | no interaction database — by design until pharmacist review |

## Biggest structural gaps

1. **Condition personalization is ~0% active** — everything is gated on review; the only real condition-aware paths are escalations/blocks/warnings.
2. **No CVD coverage** in spec or code — a spec gap to raise with product owner.
3. **No verified composition/allergen model** — warnings rely on declared ingredient attributes; cross-contact unknown.
4. **Medication context is a trigger, not a knowledge base.**
