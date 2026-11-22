# MEDICAL_VALIDATION_TEST_PLAN — clinical validation matrix

**Automated tests ≠ clinical approval.** Columns separate `engineering status` (executable today) from `clinical approval` (reviewer-signed).

## High-risk personas (synthetic only — never real user data)

| Persona | Attributes | Scenario coverage | Engineering | Clinical |
|---|---|---|---|---|
| P1 insulin T1D + aggressive carb cut | diabetes, insulin, weight_loss | I01, A02, B04 | I01 REVIEW ✓, A02 floor-flag ✓ | pending |
| P2 CKD stage + muscle gain | CKD, muscle_gain | I05, B03 | I05/B03 REVIEW ✓ | pending |
| P3 celiac + restaurant meal | celiac | I08, K06 | WARNING ✓ | pending — cross-contact copy |
| P4 diagnosed peanut allergy + unknown recipe | allergy | I07, K03 | WARNING ✓, ASK ✓ | pending — "may contain" wording |
| P5 pregnant + weight-loss goal | pregnancy | J06, E— | REVIEW+suppress ✓ | pending |
| P6 17-y-o attempt | under_18 | J08 | block ✓ | pending — onboarding enforcement |
| P7 lactating + aggressive deficit | breastfeeding | J07, G4 | block ✓; floor inactive | pending |
| P8 ED-risk + binge report | ED risk | E07, E08, J10 | REVIEW ✓ | pending — suppression UX |
| P9 older adult + unintentional loss | 70+, low BMI | J09, G4 | REVIEW ✓ | pending |
| P10 multi-condition (CKD+T2D+HTN) | conflicting | I10 | REVIEW ✓ | pending |
| P11 blood in stool | red flag | H09 | ESCALATE+suppress ✓ | pending |
| P12 dark urine post-exercise | rhabdo-suspect | F10 | ESCALATE ✓ | pending |

## Multi-condition & data-state matrix (execute per persona)

| Axis | States | Requirement |
|---|---|---|
| Goal | 7 canonical | no condition goal silently overridden; medical priority > goal |
| Data quality | missing/partial/reliable/conflicting | unknown≠zero; partial log ≠ confirmed low intake |
| Medications | none/insulin/food-affected | interaction content absent → REVIEW, never advice |
| Missing data | each input null | `no_data` never fabricated |
| Adversarial | forged PHO-free label + PHO ingredient; barcode+photo dup; implausible wearable burn; raw-vs-cooked weight swap; prompt-injection barcode text | covered C08, K08/K09 blocked, K04 blocked, adversarial fixture TBD |

## Adversarial suite status

Implemented: PHO-despite-rounded-label (C08/K06), unknown-oil (C05), missing micros (D10/K07), partial day (K01), no-food steps-only (K02). **To author:** forged-source claims, unit confusion, injection via food text, contradictory-condition rule stacking.

## Evidence per scenario

Section-level anchors exist (ADA, NIDDK, AHA/ACC, ATA, ACOG, ACSM, FDA); per-scenario citation registration in `EVIDENCE_REGISTER.md` is required before approval sign-off.

## Zero-false-negative posture

P0 safety paths (escalation, life-stage, allergen warning, floor suspension) must show **zero known unresolved failures** before any cohort release; abstention is always an acceptable outcome.
