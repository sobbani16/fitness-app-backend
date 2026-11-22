# CLINICAL_RULE_APPROVAL_MATRIX — review queue (engineering ≠ approval)

**Updated:** 2026-11-21 · Rule gating VERIFIED (`scripts/verify-rule-gating.js`): all consumers load `reviewStatus:'APPROVED'` only; DB CHECK requires reviewer+evidence+clinicalAction on APPROVED rows. **0 rules approved.** Detail in `CLINICAL_RULE_REVIEW_QUEUE.md`.

## Rule-level queue

| Queue | Count | Evidence | Missing | Reviewer | Status | Release eligibility |
|---|---|---|---|---|---|---|
| A — HealthConditionNutrientRule (diabetes, prediabetes, HTN, CKD, LDL/TG, iron, thyroid) | 14 | ADA, NIH/NIDDK, AHA, AHA/ACC, NIH ODS, ATA | numeric threshold, unit, direction, period, stage applicability (CKD) | Registered Dietitian + physician for CKD/diabetes | DRAFT×14 | NOT eligible — thresholds absent |
| B — ConditionRule clinical_ingredient (gluten/celiac, HFCS/gout, lactose) | 3 | NIH/NIDDK ×2, ACR ×1 | `clinicalAction` text, target-condition binding | Dietitian | DRAFT×3 | NOT eligible |
| C — legacy attribute rules (allergens, sodium, potassium, caffeine cautions…) | 31 | NONE | evidence, thresholds, dedupe (2×HIGH_GLYCEMIC, 2×HIGH_SUGAR, 3×caffeine) | Dietitian/allergist | DRAFT×31 | NOT eligible — archive or evidence-attach |
| D — SupplementSafetyRule (47 seed cautions) | 47 | seed file | applicability, doses, evidence linkage | Pharmacist/dietitian | approved=false×47 | NOT eligible |

## Scenario-level review (120)

All 120 fixtures `reviewerStatus: pending`. Engineering results (56 pass / 0 fail / 64 blocked) are **separate** from clinical approval — a passing fixture asserts *my translation* of `expectedVerbatim`, which a clinician must confirm.

| Reviewer role | Scenarios |
|---|---|
| Dietitian (primary) | A01–A10, B01–B10, C01–C10, D01–D10, E01–E06, K01–K10, L01–L10 |
| Physician + dietitian | I01–I10, B03, J04/J05, H08–H10, D07 |
| Behavioral health + dietitian | E07, E08, J10, J09 |
| Obstetric/lactation review | J06, J07 |
| Sleep medicine (referral wording only) | G02, G06, G10 |
| Exercise physiology | F01–F10 (ACSM-based), L04/L05 |

**Activation eligibility rule:** a scenario/rule may activate only when (a) fixture executed PASS, (b) reviewer approved with recorded identity + date, (c) evidence registered, (d) feature flag cohort gate configured. No fictitious approvals exist in this matrix.
