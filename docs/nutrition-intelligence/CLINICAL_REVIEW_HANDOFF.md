# CLINICAL_REVIEW_HANDOFF — package for named reviewers

**Every record below has: original requirement (Appendix A verbatim), proposed engine behavior (implemented fixture), test result, risks, required reviewer. Approval status: ALL PENDING — no approvals exist or were fabricated.**

## Queue by specialty

### Dietitian — 95 records (primary reviewer)
- **Scenarios:** A01–A10, B01–B10, C01–C10, D01–D10, E01–E06, E09, E10, K01–K10, L01–L10 (all fixture-executed where marked in `SCENARIO_VALIDATION_MATRIX.md`; each fixture carries verbatim expectation + engineer-authored assert needing confirmation)
- **Rules:** 14 `HealthConditionNutrientRule` DRAFTs — **blockers: all thresholds null**; 3 `clinical_ingredient` DRAFTs; 31 legacy DRAFTs (no evidence attached; 6 duplicates). Detail: `CLINICAL_RULE_REVIEW_QUEUE.md`.
- **Proposed defaults needing sign-off:** `fat_loss≈weight_loss`, `bulking≈weight_gain` energy equivalents; ±20% macro bands (v2.1); FDA-DV fallback references.
- **Evidence:** per-rule orgs — ADA, NIH/NIDDK, AHA, AHA/ACC, NIH ODS, ATA (sourceUrls in `RuleEvidence` rows).

### Physician (+ dietitian) — medical conditions
- I01 insulin + carb restriction, I02 hypoglycemia symptoms, I03–I06 (TG/LDL/HTN — personalized guidance), I07 allergen warning wording, I08 celiac + cross-contact copy, I09 PCOS/thyroid framing, I10 conflicts.
- **Risk:** wrong threshold/wording = clinical harm; all rules inert until approved.
- H08–H10 persistent/severe abdominal symptom escalation copy.
- D07 potassium caution — needs reviewed limits per population.

### Allergist — I07, I08, allergen rules, cross-contact
- `safety_warning` outcome wording; **must review**: what counts as "possible exposure" vs "insufficient composition data"; the system must never claim verified allergen-freedom. Composition model incomplete — see `CONDITION_FEATURE_GAP_ANALYSIS.md`.

### Pharmacist — medication/supplement paths
- J01–J05 supplement questions, medication interactions, 47 supplement DRAFT rules (`humai_supplement_research_seed_v1.json`).
- **Boundary:** no interaction database exists — by design until pharmacist review supplies content + contraindications.

### Eating-disorder specialist — E07, E08, J10, L02, G4 calorie floor
- `eating_disorder_risk` → review; `assessWeightLossRate` bound is a parameter — **specialist sets the number**; `calorieSafety.js` floor formula (BMR-derived, inactive) needs sign-off; suppress-numbers UX not yet built.

### Obstetric/lactation — J06, J07
- Life-stage blocks verified; pregnancy/lactation guidance content itself requires OB review before any activation.

### Sleep medicine (wording) — G02, G06, G10
- Review-path copy only; no diagnosis anywhere.

## Reviewer workflow per record

1. Confirm fixture `assert` faithfully encodes `expectedVerbatim` (fix if not — recorded in DECISIONS).
2. Supply missing clinical parameters (thresholds, bounds, applicability, exclusions).
3. Verify evidence source is current + licensed for use.
4. Approve → sets `reviewedBy/reviewedAt` (DB CHECK enforces evidence + clinicalAction) or reject with reason.
5. Activation only via flag cohort (see `FEATURE_ACTIVATION_MATRIX.md`) — approval ≠ auto-release.

## Medical-flag gates added (2026-11-21)

Five flags registered OFF/fail-closed (`group:'medical'`): `allergen_warnings`, `calorie_floor_policy`, `condition_rules`, `supplement_safety`, `medication_interaction`. They gate *surfacing only* — each underlying rule still requires `APPROVED` status by a named reviewer. See `FEATURE_FLAG_GOVERNANCE.md` and `NUTRITION_ENGINE_INTEGRATION_STATUS.md`.

### Per-specialty package pointers
- **Dietitian**: goal energy equivalents (fat_loss≈weight_loss, bulking≈weight_gain), ±20% macro bands, D03–D06 micronutrient thresholds, 14 null-threshold nutrient rules, calorie-floor proposal (`calorieSafety.js` — floor null until set).
- **Physician**: persistent-symptom escalation copy, life-stage blocks, I09 PCOS/thyroid framing, rapid-loss review bound for `assessWeightLossRate`.
- **Allergist**: `safety_warning` outcome wording + composition-uncertainty model (I07/I08); `allergen_warnings` flag has no consumer until wording approved.
- **Pharmacist**: 47 supplement DRAFT rules, J02/J03 content, `supplement_safety`/`medication_interaction` activation prerequisites.
- **ED specialist**: A05 (review-only, no consumer), G4 floor, L02 rate bound, any underconsumption messaging.
- **Obstetric**: I10 pregnancy/lactation — full block, no waiver path.
