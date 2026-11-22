# MEDICAL_LAUNCH_SCOPE — condition personalization, US + India

**Date:** 2026-11-21 · Sources: Appendix A, `CLINICAL_RULE_REVIEW_QUEUE.md`, `SCENARIO_VALIDATION_FINAL.md`, `FINDINGS.jsonl`, schema + route inventory. This document classifies **function for external regulatory review** — it makes NO final legal claim (FDA general-wellness vs CDS vs device, CDSCO/DPDP classification all require counsel).

## Condition-specific behavior inventory (as shipped)

| Condition | Where behavior exists today | Status |
|---|---|---|
| Type 1/2 diabetes | `HealthConditionNutrientRule` DRAFTs (sugar_added, carbs), scenario I01/I02/I03, decisionEngine `insulin_carbs_restriction`, `hypoglycemia_symptoms` | rules inert (DRAFT); escalation paths tested |
| Prediabetes | rule DRAFT (sugar_added) | inert |
| Hypertension | rule DRAFT (sodium), scenario I06 | inert; sodium moderation part exists in score |
| Dyslipidemia (LDL/triglycerides) | 3 rule DRAFTs (sat fat, sugar; AHA/ACC evidence), scenarios I03/I04 | inert |
| CKD | 2 rule DRAFTs (K⁺, PO₄), `ckd_protein_target` trigger, I05, calorieSafety `medically_complex` | inert; review path tested |
| CVD | none specific — falls under dyslipidemia rules | gap |
| Thyroid (hypo/hyper) | 2 rule DRAFTs (iodine; ATA), scenario I09, `THYROID_CAUTION` supplement DRAFTs | inert |
| PCOS | scenario I09 only — no rules | guidance-only |
| Pregnancy/lactation | `pregnancy`/`breastfeeding` life-stage blocks, J06/J07, calorieSafety flags, PREGNANCY_CAUTION DRAFTs | blocks tested |
| Food allergies | `ingredientValidator` (APPROVED-only rules), `diagnosed_allergen_exposure` → new `safety_warning` outcome, I07/I08 | partial — no per-allergen composition model |
| Celiac | `CONTAINS_GLUTEN` DRAFT + `celiac_gluten_exposure` → `safety_warning`, I08 | inert rule; warning path tested |
| Under-18 / older adult / ED risk | life-stage blocks J08/J09/J10, calorieSafety flags | tested |
| Insulin/medication | `medication_interaction`, `insulin_carbs_restriction` triggers, J04/J05 | review path only — no interaction content exists |

## Feature matrix by condition (capabilities, not claims)

| Capability | Applies to | Class (provisional) | Rationale | Open question |
|---|---|---|---|---|
| Macro/micro adequacy scores | all | general wellness | no condition-specific claim | — |
| Condition rule engine (`ConditionRule`/`HealthConditionNutrientRule`) | diabetes, HTN, CKD, dyslipidemia, thyroid | **potentially regulated** | disease-specific nutrient limits = clinical decision support | CDS non-device criteria (HCP-facing?); in India, CDSCO device rules on software claims — counsel |
| Allergen exposure warnings | allergy, celiac | **potentially regulated** | high-stakes safety claim | duty-of-care on "may contain" cross-contact wording |
| Life-stage blocks (preg/u18/lactation) | pregnancy, minors | wellness safeguard | suppresses rather than advises | labeling/indication statements |
| Escalation triggers (`decisionEngine`) | all | wellness safeguard | routes to professional, no advice content | escalation wording review |
| `calorieSafety` floors | weight goals | **potentially regulated** | individualized calorie floor ≈ clinical parameter | dietitian sign-off + claims review |
| Medication-interaction warnings | medicated users | **prohibited pending review** | drug-food interaction content | requires pharmacist + evidence base |
| Supplement condition cautions | thyroid/CKD/preg/diabetes | **prohibited pending review** | disease-adjacent supplement claims | FSSAI/FDA supplement claims rules |
| Insulin/carb advice | T1D insulin users | **prohibited pending review** | adjacent to dosing | must route to prescriber; no carb-ratio logic |

**Populations are NOT interchangeable** — e.g., CKD + muscle-gain is a protein-target conflict (I05); pregnancy + weight-loss is a blocked pathway (J06); diabetes on insulin + carb restriction requires medication context (I01).

## Per-country notes for reviewers

- **US:** FDA general-wellness guidance (low-risk, no disease claims) vs CDS exemption (HCP-facing, transparent basis) vs SaMD. Patient-facing disease-specific nutrient targets likely exceed general wellness. FTC substantiation applies to all claims. HIPAA likely not applicable (no covered-entity relationship) — state laws (Washington My Health My Data, California CMIA) may be.
- **India:** CDSCO — software as medical device under Medical Device Rules 2017 depends on claims; DPDP Act 2023 governs health data (consent, purpose limitation); FSSAI regulates nutraceutical/food claims; Dietetics/NCAHP for reviewer credentials. No assumption either way — counsel review required per feature.
