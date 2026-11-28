# Clinical Review Guide — 47 Supplement-Interaction Safety Rules

Package version: clinical-review-package-v1 · generated 2026-11-28 · source packet draft-rule-review-v1

## 1. What you are being asked to do

You are reviewing **47 draft safety rules** for a consumer supplement-tracking feature. Each rule describes when the product should warn the user, suppress an automated recommendation, or direct the user to a clinician. **None of these rules are active today** — every one is inert until a qualified reviewer approves it. The product currently reports every one of these checks as NOT_CHECKED and never presents their absence as safety.

For **each rule individually**, choose one of:

- **APPROVE** — the rule text, trigger, and proposed action are clinically correct as written.
- **MODIFY** — the rule is needed but the text/threshold/wording requires correction. Write the corrected text in the modification field. Engineering will re-verify the corrected text mechanically before activation.
- **REJECT** — the rule should never activate (wrong, obsolete, or out of scope for a consumer product).

Sign each decision with your name, credentials and date. The spreadsheet (`supplement-rule-review-package.csv`) has one row per rule with empty review columns; this guide has a sign-off block per rule; the JSON (`supplement-rule-review-package.json`) is the machine-readable record engineering will consume.

## 2. Required reviewer qualifications

- **Primary reviewer: clinical pharmacist** with drug–supplement interaction competence (the largest rule category is medication interactions, 14/47).
- **Specialist co-review** for the categories marked per-rule below: obstetric/maternal-fetal input for pregnancy rules (4), physician specialist input for condition contraindications (11), pediatric input for the age-group rule, laboratory medicine input for the immunoassay-interference rule.
- A single reviewer may cover multiple categories if credentialed; the per-rule `requiredSpecialty` field states the minimum for each.

## 3. What the severity labels mean here

- **CRITICAL (11 rules)** — life-safety or irreversible-harm potential (e.g. pregnancy teratogenicity, hyperkalemia in renal disease, warfarin interaction).
- **HIGH (32 rules)** — clinically meaningful harm potential requiring professional judgment.
- **MODERATE (4 rules)** — quality-of-use and lesser-risk concerns.

## 4. Provenance and limitations you should know

- Every rule cites its source (NIH Office of Dietary Supplements fact sheets and comparable references) — the URL is in each rule section.
- **16 of 47 rules are technically evaluable by the product engine today.** The other 31 require engineering surfaces that do not yet exist (user medication list integration, laboratory context, dose-total composition data). Those are being built independently; approval of a rule does not activate it until its evaluation surface also exists. You are reviewing clinical correctness, not engineering readiness.
- Rules marked `engineEvaluatableToday: NO` still need review now — their activation order will follow engineering completion.

## 5. The four QA scenarios requiring your disposition

The product’s original deployed regression included four DRAFT-rule cases (`RST-05`, `RULE-10`, `RULE-13`, `RULE-14`) whose definitions were never committed to any repository and are **unrecoverable** (verified by exhaustive search). The four replacement scenarios below are **new, clearly-labeled replacements — not reconstructions**. For each, confirm whether the "expected if approved" behavior is clinically correct; your answer becomes the QA expected-result definition.

### SUPP-REPL-01 — vitamin-a / LIFE_STAGE

- Replaces: `RST-05 (UNRECOVERED — this is a replacement, not a reconstruction)`
- Category: LIFE_STAGE / pregnancy — highest-consequence population
- Rule: PREGNANT_OR_TRYING → REFER_CLINICIAN
- Draft warning text: "High-dose preformed vitamin A can cause birth defects; evaluate prenatal formulation."
- Engine evaluable today: YES
- Expected while DRAFT: Rule inert: no block, no warning; engine reports the check as NOT_CHECKED. Any behavior otherwise is a defect.
- Expected if approved: REFER_CLINICIAN disposition: user is directed to clinical evaluation of prenatal formulation; automated scheduling/recommendation of the product is suppressed.
- **Your disposition**: Confirm whether the expected-if-approved behavior is clinically correct and sufficient, or specify the correct behavior ( MODIFY ). This becomes the QA expected-result definition.

Disposition: ☐ correct as stated ☐ correct with modification: ____________ ☐ incorrect: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### SUPP-REPL-02 — vitamin-k / MEDICATION

- Replaces: `RULE-10 (UNRECOVERED — this is a replacement, not a reconstruction)`
- Category: MEDICATION / warfarin — most consequential drug-supplement interaction class
- Rule: WARFARIN_OR_VKA → REFER_CLINICIAN
- Draft warning text: "Maintain consistent vitamin K intake and consult prescribing team; do not advise avoiding all vitamin K."
- Engine evaluable today: NO
- Expected while DRAFT: Rule inert AND engine surface missing: medication list is not loaded by safetyEngine today. Check must report NOT_CHECKED — never implied-safe. Engine must not claim the interaction was evaluated.
- Expected if approved: REFER_CLINICIAN: consistent-intake counseling language (per draft warning — do NOT advise blanket vitamin-K avoidance); prescribing-team consultation directed. Requires the medication evaluation surface (§2 engineering) to exist first.
- **Your disposition**: Confirm the counseling posture (consistent intake vs. avoidance) — the draft explicitly warns against advising avoidance; clinical confirmation is required before any user-facing text ships.

Disposition: ☐ correct as stated ☐ correct with modification: ____________ ☐ incorrect: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### SUPP-REPL-03 — potassium / CONDITION

- Replaces: `RULE-13 (UNRECOVERED — this is a replacement, not a reconstruction)`
- Category: CONDITION / kidney disease — hyperkalemia risk, life-safety critical
- Rule: KIDNEY_DISEASE → REFER_CLINICIAN
- Draft warning text: "Potassium products can cause dangerous hyperkalemia in renal impairment."
- Engine evaluable today: YES
- Expected while DRAFT: Rule inert: no block, no warning; check reported NOT_CHECKED.
- Expected if approved: REFER_CLINICIAN: automated potassium advice suppressed; user directed to clinician. No dosage workaround or softened copy may substitute.
- **Your disposition**: Confirm severity grading and whether any potassium intake level is ever acceptable to surface without clinician referral in this population.

Disposition: ☐ correct as stated ☐ correct with modification: ____________ ☐ incorrect: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### SUPP-REPL-04 — biotin / LAB_TEST

- Replaces: `RULE-14 (UNRECOVERED — this is a replacement, not a reconstruction)`
- Category: LAB_TEST / immunoassay interference — diagnostic-safety class (troponin interference is a recognized cause of misdiagnosis)
- Rule: TROPONIN_THYROID_IMMUNOASSAY → LAB_DISCLOSURE_WARNING
- Draft warning text: "High-dose biotin can interfere with some troponin and hormone immunoassays; disclose to testing team."
- Engine evaluable today: NO
- Expected while DRAFT: Rule inert AND no lab surface exists: check reported NOT_CHECKED. No lab-related claim may be made.
- Expected if approved: LAB_DISCLOSURE_WARNING: user is advised to disclose biotin intake to the testing team before troponin/thyroid immunoassays. Requires the lab-context evaluation surface (§2 engineering).
- **Your disposition**: Confirm the disclosure-window and interference scope clinically appropriate for user-facing copy.

Disposition: ☐ correct as stated ☐ correct with modification: ____________ ☐ incorrect: ____________

Signed: ____________ Credentials: ____________ Date: ____________

## 6. The 47 rules

Rules are ordered CRITICAL first, then HIGH, then MODERATE. Review columns in the spreadsheet mirror these sections.

### Rule 3 — SUPP-D03 — CRITICAL — vitamin-a

- **Exact rule**: when trigger `LIFE_STAGE / PREGNANT_OR_TRYING` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "High-dose preformed vitamin A can cause birth defects; evaluate prenatal formulation."
- **Source**: ODS-A — https://ods.od.nih.gov/factsheets/VitaminA-Consumer/
- **Applicable population**: Pregnant, trying-to-conceive, or breastfeeding users
- **Required reviewer**: Maternal-fetal medicine specialist, obstetric clinician, or prenatal clinical pharmacist
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 5 — SUPP-D05 — CRITICAL — vitamin-k

- **Exact rule**: when trigger `MEDICATION / WARFARIN_OR_VKA` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Maintain consistent vitamin K intake and consult prescribing team; do not advise avoiding all vitamin K."
- **Source**: ODS-K — https://ods.od.nih.gov/factsheets/VitaminK-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 10 — SUPP-D10 — CRITICAL — iron

- **Exact rule**: when trigger `CONDITION / HEMOCHROMATOSIS_OR_IRON_OVERLOAD` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Extra iron can be harmful; do not suggest iron without indication."
- **Source**: ODS-IRON — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 12 — SUPP-D12 — CRITICAL — magnesium

- **Exact rule**: when trigger `CONDITION / SIGNIFICANT_KIDNEY_DISEASE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Reduced renal excretion raises magnesium toxicity risk."
- **Source**: ODS-MAG — https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 17 — SUPP-D17 — CRITICAL — potassium

- **Exact rule**: when trigger `CONDITION / KIDNEY_DISEASE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Potassium products can cause dangerous hyperkalemia in renal impairment."
- **Source**: ODS-INDEX — https://ods.od.nih.gov/factsheets/list-all/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 18 — SUPP-D18 — CRITICAL — potassium

- **Exact rule**: when trigger `MEDICATION / ACE_ARB_POTASSIUM_SPARING` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Some blood-pressure and diuretic drugs can increase potassium; avoid automatic potassium advice."
- **Source**: ODS-INDEX — https://ods.od.nih.gov/factsheets/list-all/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 23 — SUPP-D23 — CRITICAL — biotin

- **Exact rule**: when trigger `LAB_TEST / TROPONIN_THYROID_IMMUNOASSAY` matches, proposed action `LAB_DISCLOSURE_WARNING`
- **Draft consumer-facing text**: "High-dose biotin can interfere with some troponin and hormone immunoassays; disclose to testing team."
- **Source**: ODS-BIOTIN — https://ods.od.nih.gov/factsheets/Biotin-HealthProfessional/
- **Applicable population**: Users undergoing the named laboratory tests
- **Required reviewer**: Laboratory medicine specialist / pathologist, or clinician ordering the affected tests
- **Engine evaluable today**: NO — lab result records — no lab surface exists
- **Limitations**:
  - Engine cannot evaluate this rule today: lab result records — no lab surface exists
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 39 — SUPP-D39 — CRITICAL — st. john's wort

- **Exact rule**: when trigger `MEDICATION / ANTIDEPRESSANT_BIRTH_CONTROL_TRANSPLANT` matches, proposed action `NO_AUTO_RECOMMEND`
- **Draft consumer-facing text**: "Strong interactions may reduce drug effectiveness or increase serotonin toxicity."
- **Source**: NCCIH-STJOHN — https://www.nccih.nih.gov/health/st-johns-wort
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 40 — SUPP-D40 — CRITICAL — kava

- **Exact rule**: when trigger `CONDITION / LIVER_DISEASE_OR_SEDATIVES` matches, proposed action `NO_AUTO_RECOMMEND`
- **Draft consumer-facing text**: "Serious liver injury and sedative effects have been reported with kava products."
- **Source**: NCCIH-KAVA — https://www.nccih.nih.gov/health/kava
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 41 — SUPP-D41 — CRITICAL — red yeast rice

- **Exact rule**: when trigger `MEDICATION / STATIN_OR_LIVER_DISEASE` matches, proposed action `NO_AUTO_RECOMMEND`
- **Draft consumer-facing text**: "May contain statin-like monacolin K; muscle/liver/kidney risks and regulatory concerns."
- **Source**: NCCIH-RED — https://www.nccih.nih.gov/health/red-yeast-rice
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 42 — SUPP-D42 — CRITICAL — berberine

- **Exact rule**: when trigger `LIFE_STAGE / PREGNANCY_OR_BREASTFEEDING` matches, proposed action `NO_AUTO_RECOMMEND`
- **Draft consumer-facing text**: "Avoid automated berberine advice during pregnancy, breastfeeding or for infants."
- **Source**: NCCIH-BERBERINE — https://www.nccih.nih.gov/health/diabetes-and-dietary-supplements-what-you-need-to-know
- **Applicable population**: Pregnant, trying-to-conceive, or breastfeeding users
- **Required reviewer**: Maternal-fetal medicine specialist, obstetric clinician, or prenatal clinical pharmacist
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 1 — SUPP-D01 — HIGH — vitamin-d

- **Exact rule**: when trigger `DOSE_TOTAL / ALL_D_SOURCES` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Sum vitamin D2, D3 and combination products; excess can cause hypercalcemia."
- **Source**: ODS-D — https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 2 — SUPP-D02 — HIGH — vitamin-d

- **Exact rule**: when trigger `CONDITION / HYPERCALCEMIA_OR_KIDNEY_DISORDER` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Do not auto-recommend vitamin D regimens in calcium disorders or significant kidney disease."
- **Source**: ODS-D — https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 4 — SUPP-D04 — HIGH — vitamin-a

- **Exact rule**: when trigger `LIFESTYLE / SMOKING_OR_ASBESTOS_EXPOSURE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "High-dose beta-carotene supplements have been associated with increased lung cancer risk in smokers/former smokers."
- **Source**: ODS-A — https://ods.od.nih.gov/factsheets/VitaminA-Consumer/
- **Applicable population**: Users with the named exposure history
- **Required reviewer**: Physician with oncology/respiratory domain context
- **Engine evaluable today**: NO — user lifestyle factors (smoking/occupational exposure) — no such profile field
- **Limitations**:
  - Engine cannot evaluate this rule today: user lifestyle factors (smoking/occupational exposure) — no such profile field
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 6 — SUPP-D06 — HIGH — iron

- **Exact rule**: when trigger `MEDICATION / LEVOTHYROXINE` matches, proposed action `SEPARATION_CHECK` with minimum separation 4h
- **Draft consumer-facing text**: "Iron supplements can impair levothyroxine absorption; many labels advise separation by 4 hours."
- **Source**: ODS-IRON — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 7 — SUPP-D07 — HIGH — calcium

- **Exact rule**: when trigger `MEDICATION / LEVOTHYROXINE` matches, proposed action `SEPARATION_CHECK` with minimum separation 4h
- **Draft consumer-facing text**: "Calcium carbonate can impair levothyroxine absorption; labeling advises at least 4 hours separation."
- **Source**: ODS-CALCIUM — https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 11 — SUPP-D11 — HIGH — iron

- **Exact rule**: when trigger `DOSE_TOTAL / IRON_MULTIVITAMIN_COMBINATION` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Sum elemental iron from prenatal, multivitamin and stand-alone products."
- **Source**: ODS-IRON — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 13 — SUPP-D13 — HIGH — magnesium

- **Exact rule**: when trigger `MEDICATION / TETRACYCLINE_OR_FLUOROQUINOLONE` matches, proposed action `LABEL_SEPARATION`
- **Draft consumer-facing text**: "Supplemental magnesium can impair absorption of certain antibiotics; use medication-specific separation."
- **Source**: ODS-MAG — https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 14 — SUPP-D14 — HIGH — calcium

- **Exact rule**: when trigger `MEDICATION / CERTAIN_ANTIBIOTICS` matches, proposed action `LABEL_SEPARATION`
- **Draft consumer-facing text**: "Calcium can bind certain antibiotics; timing depends on exact drug label."
- **Source**: ODS-CALCIUM — https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 15 — SUPP-D15 — HIGH — zinc

- **Exact rule**: when trigger `MEDICATION / CERTAIN_ANTIBIOTICS` matches, proposed action `LABEL_SEPARATION`
- **Draft consumer-facing text**: "Zinc can reduce absorption of some antibiotics; follow drug-specific instructions."
- **Source**: ODS-INDEX — https://ods.od.nih.gov/factsheets/list-all/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 16 — SUPP-D16 — HIGH — zinc

- **Exact rule**: when trigger `DOSE_TOTAL / HIGH_ZINC` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Chronic excess zinc may cause copper deficiency and neurological/hematologic effects."
- **Source**: ODS-INDEX — https://ods.od.nih.gov/factsheets/list-all/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 19 — SUPP-D19 — HIGH — iodine

- **Exact rule**: when trigger `CONDITION / THYROID_DISEASE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Both excess and deficiency iodine can worsen thyroid function; label quantity matters."
- **Source**: ODS-IODINE — https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 20 — SUPP-D20 — HIGH — iodine

- **Exact rule**: when trigger `PRODUCT_COMPOSITION / KELP_SEA_MOSS` matches, proposed action `REQUIRE_PRODUCT_LABEL`
- **Draft consumer-facing text**: "Seaweed supplements may contain highly variable amounts of iodine."
- **Source**: ODS-IODINE — https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/
- **Applicable population**: Users of combination/kelp/sea-moss products
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — full strain/species-level product composition — not in schema
- **Limitations**:
  - Engine cannot evaluate this rule today: full strain/species-level product composition — not in schema
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 21 — SUPP-D21 — HIGH — selenium

- **Exact rule**: when trigger `DOSE_TOTAL / HIGH_SELENIUM` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Too much selenium can cause hair/nail and neurologic toxicity."
- **Source**: ODS-SELENIUM — https://ods.od.nih.gov/factsheets/Selenium-HealthProfessional/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 22 — SUPP-D22 — HIGH — vitamin-b6

- **Exact rule**: when trigger `DOSE_TOTAL / HIGH_B6` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Chronic excess supplemental B6 can cause sensory neuropathy."
- **Source**: ODS-B6 — https://ods.od.nih.gov/factsheets/VitaminB6-HealthProfessional/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 24 — SUPP-D24 — HIGH — vitamin-e

- **Exact rule**: when trigger `MEDICATION / WARFARIN_ANTIPLATELET` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "High supplemental vitamin E may increase bleeding risk with anticoagulants or antiplatelet drugs."
- **Source**: ODS-E — https://ods.od.nih.gov/factsheets/VitaminE-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 26 — SUPP-D26 — HIGH — omega3

- **Exact rule**: when trigger `DOSE_TOTAL / MULTIPLE_OMEGA_PRODUCTS` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Avoid double-counting fish oil, algae oil, krill, cod-liver oil or EPA/DHA blends."
- **Source**: ODS-OMEGA — https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 27 — SUPP-D27 — HIGH — omega3

- **Exact rule**: when trigger `ALLERGY / FISH_SHELLFISH` matches, proposed action `REQUIRE_PRODUCT_LABEL`
- **Draft consumer-facing text**: "Check product source: fish oil and krill oil may pose relevant allergy risks."
- **Source**: ODS-OMEGA — https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/
- **Applicable population**: Users with the named allergy
- **Required reviewer**: Allergist or clinical pharmacist
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 28 — SUPP-D28 — HIGH — prenatal

- **Exact rule**: when trigger `LIFE_STAGE / PREGNANT_OR_TRYING` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Folic acid, iron, iodine and other needs are life-stage specific; confirm composition with prenatal care team."
- **Source**: ODS-PREG — https://ods.od.nih.gov/factsheets/Pregnancy-HealthProfessional/
- **Applicable population**: Pregnant, trying-to-conceive, or breastfeeding users
- **Required reviewer**: Maternal-fetal medicine specialist, obstetric clinician, or prenatal clinical pharmacist
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 29 — SUPP-D29 — HIGH — supplement-fat-soluble

- **Exact rule**: when trigger `DOSE_TOTAL / VITAMINS_A_D_E_K` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Check multiple overlapping products and upper limits; no blanket dose recommendations."
- **Source**: ODS-INDEX — https://ods.od.nih.gov/factsheets/list-all/
- **Applicable population**: All users of the supplement, especially multi-product users
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — per-ingredient dose totals across the user's stack — composition data required
- **Limitations**:
  - Engine cannot evaluate this rule today: per-ingredient dose totals across the user's stack — composition data required
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 30 — SUPP-D30 — HIGH — probiotic

- **Exact rule**: when trigger `CONDITION / IMMUNOCOMPROMISED_OR_CENTRAL_LINE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Certain live-microorganism supplements pose extra risks for severely ill or immunocompromised patients."
- **Source**: ODS-PROBIO — https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 32 — SUPP-D32 — HIGH — psyllium

- **Exact rule**: when trigger `ADMINISTRATION / INADEQUATE_WATER_OR_SWALLOWING_RISK` matches, proposed action `REQUIRE_ADMIN_INSTRUCTIONS`
- **Draft consumer-facing text**: "Psyllium requires sufficient liquid and is unsuitable for some swallowing/obstruction risks."
- **Source**: MEDLINE-PSY — https://medlineplus.gov/druginfo/meds/a601104.html
- **Applicable population**: Users with swallowing difficulty or inadequate fluid intake
- **Required reviewer**: Clinical pharmacist; speech-language pathology input where swallowing risk is cited
- **Engine evaluable today**: NO — dosage-form/administration metadata on the product
- **Limitations**:
  - Engine cannot evaluate this rule today: dosage-form/administration metadata on the product
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 33 — SUPP-D33 — HIGH — ashwagandha

- **Exact rule**: when trigger `CONDITION / PREGNANCY_THYROID_LIVER` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Ashwagandha can interact with thyroid/immune medicines and has pregnancy/liver concerns."
- **Source**: NCCIH-ASH — https://www.nccih.nih.gov/health/ashwagandha
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 34 — SUPP-D34 — HIGH — melatonin

- **Exact rule**: when trigger `AGE_GROUP / CHILDREN_AND_ADOLESCENTS` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Do not promote routine pediatric melatonin schedules; special safety and ingestion concerns."
- **Source**: NCCIH-MEL — https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know
- **Applicable population**: Children and adolescents
- **Required reviewer**: Pediatric clinician
- **Engine evaluable today**: NO — user date of birth → age band — user row not loaded by safetyEngine
- **Limitations**:
  - Engine cannot evaluate this rule today: user date of birth → age band — user row not loaded by safetyEngine
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 35 — SUPP-D35 — HIGH — melatonin

- **Exact rule**: when trigger `MEDICATION / SEDATIVE_DRUGS` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Sedation may add to other sedatives; review timing and context."
- **Source**: NCCIH-MEL — https://www.nccih.nih.gov/health/melatonin-what-you-need-to-know
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 36 — SUPP-D36 — HIGH — caffeine

- **Exact rule**: when trigger `OTHER_SUPPLEMENT / PRE_WORKOUT_GUARANA` matches, proposed action `TOTAL_EXPOSURE_CHECK`
- **Draft consumer-facing text**: "Total caffeine from drinks, pre-workouts and guarana must be counted together."
- **Source**: ODS-PERFORMANCE — https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/
- **Applicable population**: Users combining the named supplements
- **Required reviewer**: Clinical pharmacist
- **Engine evaluable today**: NO — full supplement stack cross-reference (loaded links)
- **Limitations**:
  - Engine cannot evaluate this rule today: full supplement stack cross-reference (loaded links)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 37 — SUPP-D37 — HIGH — caffeine

- **Exact rule**: when trigger `CONDITION / ARRHYTHMIA_ANXIETY_SLEEP_PREGNANCY` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Stimulant use may be inappropriate for some conditions and life stages."
- **Source**: ODS-PERFORMANCE — https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 38 — SUPP-D38 — HIGH — green tea extract (EGCG)

- **Exact rule**: when trigger `CONDITION / LIVER_DISEASE` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Concentrated green-tea extracts have been linked to liver injury; do not suggest automatically."
- **Source**: NCCIH-GREEN — https://www.nccih.nih.gov/health/green-tea
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 43 — SUPP-D43 — HIGH — berberine

- **Exact rule**: when trigger `MEDICATION / GLUCOSE_LOWERING_DRUGS` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "May alter glucose responses and interact with medications; clinician review required."
- **Source**: NCCIH-BERBERINE — https://www.nccih.nih.gov/health/diabetes-and-dietary-supplements-what-you-need-to-know
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 44 — SUPP-D44 — HIGH — glucosamine / chondroitin

- **Exact rule**: when trigger `MEDICATION / WARFARIN` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Possible bleeding interaction with warfarin; review existing therapy."
- **Source**: NCCIH-GLUC — https://www.nccih.nih.gov/health/glucosamine-and-chondroitin-for-osteoarthritis-what-you-need-to-know
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 45 — SUPP-D45 — HIGH — cod liver oil

- **Exact rule**: when trigger `LIFE_STAGE / PREGNANCY` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Cod liver oil may contain preformed vitamin A; require label and prenatal review."
- **Source**: ODS-PREG — https://ods.od.nih.gov/factsheets/Pregnancy-HealthProfessional/
- **Applicable population**: Pregnant, trying-to-conceive, or breastfeeding users
- **Required reviewer**: Maternal-fetal medicine specialist, obstetric clinician, or prenatal clinical pharmacist
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 46 — SUPP-D46 — HIGH — sea moss (Irish moss)

- **Exact rule**: when trigger `CONDITION / THYROID_DISEASE` matches, proposed action `REQUIRE_PRODUCT_LABEL`
- **Draft consumer-facing text**: "Check iodine and contaminants; no blanket 'thyroid-support' claims."
- **Source**: ODS-IODINE — https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/
- **Applicable population**: Users with the named medical condition(s)
- **Required reviewer**: Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications
- **Engine evaluable today**: YES
- **Limitations**:
  - Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 47 — SUPP-D47 — HIGH — shilajit

- **Exact rule**: when trigger `PRODUCT_QUALITY / METAL_CONTAMINATION` matches, proposed action `NO_AUTO_RECOMMEND`
- **Draft consumer-facing text**: "Potential heavy-metal contamination; require reputable testing and safety review."
- **Source**: FDA — https://www.fda.gov/food/dietary-supplements/information-consumers-using-dietary-supplements
- **Applicable population**: All users of products with contamination risk
- **Required reviewer**: Clinical pharmacist or pharmacologist/toxicologist
- **Engine evaluable today**: NO — third-party purity/contamination data per product — not in schema
- **Limitations**:
  - Engine cannot evaluate this rule today: third-party purity/contamination data per product — not in schema
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 8 — SUPP-D08 — MODERATE — iron

- **Exact rule**: when trigger `OTHER_SUPPLEMENT / CALCIUM` matches, proposed action `SEPARATION_REVIEW`
- **Draft consumer-facing text**: "Calcium can reduce iron absorption; review taking them at different times."
- **Source**: ODS-IRON — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **Applicable population**: Users combining the named supplements
- **Required reviewer**: Clinical pharmacist
- **Engine evaluable today**: NO — full supplement stack cross-reference (loaded links)
- **Limitations**:
  - Engine cannot evaluate this rule today: full supplement stack cross-reference (loaded links)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 9 — SUPP-D09 — MODERATE — iron

- **Exact rule**: when trigger `FOOD / COFFEE_TEA_DAIRY` matches, proposed action `MEAL_CONTEXT_WARNING`
- **Draft consumer-facing text**: "Tea/coffee and some co-ingested foods may reduce nonheme iron absorption."
- **Source**: ODS-IRON — https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/
- **Applicable population**: Users consuming the named foods near dosing time
- **Required reviewer**: Clinical dietitian or clinical pharmacist
- **Engine evaluable today**: NO — recent food log context — not loaded by safetyEngine
- **Limitations**:
  - Engine cannot evaluate this rule today: recent food log context — not loaded by safetyEngine
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 25 — SUPP-D25 — MODERATE — omega3

- **Exact rule**: when trigger `MEDICATION / ANTICOAGULANT` matches, proposed action `REFER_CLINICIAN`
- **Draft consumer-facing text**: "Review high-dose omega-3 products and drug regimen; bleeding-risk implications depend on dose and context."
- **Source**: ODS-OMEGA — https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/
- **Applicable population**: Users taking the named medication class
- **Required reviewer**: Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity
- **Engine evaluable today**: NO — user medication list — NOT loaded by safetyEngine (no medication surface exists)
- **Limitations**:
  - Engine cannot evaluate this rule today: user medication list — NOT loaded by safetyEngine (no medication surface exists)
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

### Rule 31 — SUPP-D31 — MODERATE — probiotic

- **Exact rule**: when trigger `PRODUCT_COMPOSITION / GENUS_SPECIES_STRAIN_CFU` matches, proposed action `REQUIRE_PRODUCT_LABEL`
- **Draft consumer-facing text**: "Require strain designation, viable CFU, expiration and storage details for benefit claims."
- **Source**: ODS-PROBIO — https://ods.od.nih.gov/factsheets/Probiotics-HealthProfessional/
- **Applicable population**: Users of combination/kelp/sea-moss products
- **Required reviewer**: Clinical pharmacist or clinical dietitian
- **Engine evaluable today**: NO — full strain/species-level product composition — not in schema
- **Limitations**:
  - Engine cannot evaluate this rule today: full strain/species-level product composition — not in schema
  - Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.
  - Draft content — clinical accuracy not yet verified by a qualified reviewer.
- **Behavior while unreviewed**: Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.

Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________

Signed: ____________ Credentials: ____________ Date: ____________

## 7. What happens after your review

1. Engineering activates **only** rules you approved (or modified, using your corrected text after mechanical re-verification).
2. Activation additionally requires the rule’s evaluation surface to exist — approval alone never activates a rule the engine cannot evaluate.
3. Per-rule activation tests are written and independently QA-verified before activation.
4. Your four scenario dispositions become permanent QA expected-result definitions.
5. Rejected rules are archived with your rationale — never silently deleted.

