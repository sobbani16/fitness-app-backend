# Activity Safety — Clinical Review Assignment Matrix (Phase 22)

Generated from `src/services/activitySafety/rulesData.js` — version hashes are
SHA-256 (first 12 hex) of each rule's canonical JSON as shipped in code. A reviewer
must verify the hash of the rule they sign matches this matrix; any drift means the
code changed after packaging.

**Approval state: all 71 rules DRAFT.** This document assigns *work*, not approval.
The DB CHECK constraint requires reviewedBy/reviewedAt/evidenceSourceId with APPROVED —
there is no automated or bulk approval path.

## Priority tiers

- **P1 (high-consequence):** urgent escalation, clinical-review routing, blocks, and
  every high-severity rule. Must be reviewed by the qualification listed before any
  user-facing enablement.
- **P2:** caution-severity modifications and defers.
- **P3:** informational modifications and personalization.

## How to review a rule (exact human actions)

1. Pick an assigned rule below; confirm the version hash against the rule object in
   `src/services/activitySafety/rulesData.js`:
   `node -e "crypto.createHash('sha256').update(JSON.stringify(RULE_OBJECT)).digest('hex').slice(0,12)"`
2. Read the rule's executable examples in `docs/clinical/activity-safety-review-package.md`
   (implemented behavior, not clinical correctness).
3. Verify the evidence source cited (Evidence column) supports the effect and severity.
4. Record a decision in the adjudication queue
   (`docs/clinical/activity-safety-adjudication-queue.md`): APPROVE / REJECT / QUESTION.
5. Only after a qualified reviewer signs: an authorized engineer sets
   `reviewStatus='APPROVED'` with reviewedBy/reviewedAt/evidenceSourceId via the
   admin path — never through this matrix.
6. Any rule edit invalidates the prior hash — regenerate this matrix after edits.

## Outstanding questions for reviewers (carried from the Phase 22 audit)

- **Q-TRUNK-01:** `upper_body_ergometer` carries trunk region 0.2 but does not
  declare the `trunk_load` category. A prohibited trunk_load restriction does not
  reach it (see `docs/audits/activity-safety-phase22-exercise-suitability.md`).
  Clinical call: is the category vocabulary the right prohibition contract, or should
  a prohibited category also catch low region-scores of that domain?
- **Q-MEDFLAG-01:** Some rules are reachable only via free-form `medicationActivityFlags`
  strings (see review package — 'med-flag-only'). Reviewer must decide whether
  user-entered free text is an acceptable clinical signal channel.
- **Q-UNSUPPORTED:** AS-REC-003 / AS-REC-004 are `unsupported_input` — the product
  cannot collect the required signal. Reviewer confirms inactivation is correct vs
  building a validated collection path.

## Assignment matrix — P1 (high-consequence) first

| Rule | Name | Effect | Severity | Required qualification | Evidence | Version hash | Assigned reviewer | Approval | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AS-CORE-001 | Urgent symptom escalation | URGENT_ESCALATION | high | Emergency medicine physician or equivalent (urgent escalation semantics) | ACSM_SCREEN_2015;PARQ_PLUS;ACOG_804 | `128eba59575d` | UNASSIGNED | DRAFT | |
| AS-CORE-002 | Documented prohibition respected | BLOCK_ACTIVITY | high | Licensed PT or sports-medicine clinician | PRODUCT-POLICY | `0eceb68e6da0` | UNASSIGNED | DRAFT | |
| AS-MSK-001 | Non-weight-bearing order | BLOCK_ACTIVITY | high | Licensed PT or sports-medicine clinician | APTA_ANKLE_2021 | `4d0bb00bc391` | UNASSIGNED | DRAFT | |
| AS-MSK-005 | Severe undiagnosed pain / post-fall | NEEDS_CLINICAL_REVIEW | high | Sports-medicine physician or licensed PT (clinical-review routing) | PRODUCT-POLICY | `9baa5231aea3` | UNASSIGNED | DRAFT | |
| AS-MSK-008 | Post-surgical, undocumented restrictions | NEEDS_CLINICAL_REVIEW | high | Sports-medicine physician or licensed PT (clinical-review routing) | PRODUCT-POLICY | `52edb0ccb955` | UNASSIGNED | DRAFT | |
| AS-CV-001 | Unexplained chest pain / recent cardiac event | URGENT_ESCALATION | high | Emergency medicine physician or equivalent (urgent escalation semantics) | ACSM_SCREEN_2015 | `17ca0db69c67` | UNASSIGNED | DRAFT | |
| AS-CV-004 | Syncope/dizziness current vs history | NEEDS_CLINICAL_REVIEW | high | Sports-medicine physician or licensed PT (clinical-review routing) | PARQ_PLUS;ACSM_SCREEN_2015 | `0d707d0319f0` | UNASSIGNED | DRAFT | |
| AS-RESP-005 | Unexplained breathlessness | URGENT_ESCALATION | high | Emergency medicine physician or equivalent (urgent escalation semantics) | PARQ_PLUS;ACSM_SCREEN_2015 | `aaae5a1f34e9` | UNASSIGNED | DRAFT | |
| AS-DM-002 | Hyperglycemia + ketones | DEFER_OUTDOOR | high | Pulmonologist/allergist or exercise physiologist with env-health expertise | ADA_PA_2016 | `6d3e8c947fc6` | UNASSIGNED | DRAFT | |
| AS-PREG-002 | Pregnancy warning symptoms | URGENT_ESCALATION | high | Emergency medicine physician or equivalent (urgent escalation semantics) | ACOG_804 | `9fc5cdfffd43` | UNASSIGNED | DRAFT | |
| AS-PREG-003 | High-risk pregnancy documented restriction | NEEDS_CLINICAL_REVIEW | high | Sports-medicine physician or licensed PT (clinical-review routing) | ACOG_804 | `d0a63e183092` | UNASSIGNED | DRAFT | |
| AS-NEURO-005 | Stroke recovery undocumented | NEEDS_CLINICAL_REVIEW | caution | Sports-medicine physician or licensed PT (clinical-review routing) | clinician-doc | `9e14ccd3b9da` | UNASSIGNED | DRAFT | |
| AS-ENV-001 | Thunderstorm | DEFER_OUTDOOR | high | Pulmonologist/allergist or exercise physiologist with env-health expertise | NWS_LIGHTNING | `78a7e05a365f` | UNASSIGNED | DRAFT | |
| AS-ENV-002 | Severe alert active | DEFER_OUTDOOR | high | Pulmonologist/allergist or exercise physiologist with env-health expertise | NWS | `39c7098dfdf3` | UNASSIGNED | DRAFT | |
| AS-ENV-003 | Heat index danger | DEFER_OUTDOOR | high | Pulmonologist/allergist or exercise physiologist with env-health expertise | NWS_HEAT_INDEX | `4facc4f3f4e0` | UNASSIGNED | DRAFT | |
| AS-ENV-005 | AQI ≥201 | DEFER_OUTDOOR | high | Pulmonologist/allergist or exercise physiologist with env-health expertise | EPA_AQI | `303b827e0622` | UNASSIGNED | DRAFT | |

## P2

| Rule | Name | Effect | Severity | Required qualification | Evidence | Version hash | Assigned reviewer | Approval | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AS-CORE-003 | Unknown screening with risk flags | INSUFFICIENT_DATA | caution | Any qualified clinician + product reviewer (data-sufficiency semantics) | ACSM_SCREEN_2015;PARQ_PLUS | `c8b7d424fd19` | UNASSIGNED | DRAFT | |
| AS-MSK-002 | Acute injury ≤72h | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | APTA_ANKLE_2021 | `9ab82bf6d9e5` | UNASSIGNED | DRAFT | |
| AS-MSK-003 | Joint instability | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | APTA_ANKLE_2021 | `ba2476063227` | UNASSIGNED | DRAFT | |
| AS-CV-002 | Stable CAD / completed rehab | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | AHA_RESISTANCE_CVD;ACSM_SCREEN_2015 | `9b9deaf1e37d` | UNASSIGNED | DRAFT | |
| AS-CV-003 | Uncontrolled hypertension | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACSM_SCREEN_2015 | `7f2ee3f133a3` | UNASSIGNED | DRAFT | |
| AS-CV-005 | Stable heart failure | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | AHA statement | `6997b737586e` | UNASSIGNED | DRAFT | |
| AS-RESP-001 | Asthma/EIB + USG AQI | DEFER_OUTDOOR | caution | Pulmonologist/allergist or exercise physiologist with env-health expertise | EPA_AQI;EPA_AQ_ACTIVITY | `9638440bac9e` | UNASSIGNED | DRAFT | |
| AS-RESP-002 | Asthma + wildfire smoke | DEFER_OUTDOOR | caution | Pulmonologist/allergist or exercise physiologist with env-health expertise | EPA_WILDFIRE | `84900e0288ba` | UNASSIGNED | DRAFT | |
| AS-RESP-004 | Active respiratory infection | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `ec6428221f22` | UNASSIGNED | DRAFT | |
| AS-RESP-006 | AQI bands (general) | DEFER_OUTDOOR | caution | Pulmonologist/allergist or exercise physiologist with env-health expertise | EPA_AQI | `ebc4bf4aa556` | UNASSIGNED | DRAFT | |
| AS-DM-001 | Insulin-treated diabetes + recent hypoglycemia | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ADA_PA_2016 | `c8b1442c3a17` | UNASSIGNED | DRAFT | |
| AS-DM-003 | Peripheral neuropathy / foot ulcer history | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ADA_PA_2016 | `939f23f19436` | UNASSIGNED | DRAFT | |
| AS-DM-004 | Proliferative retinopathy | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ADA_PA_2016 | `322de62c1303` | UNASSIGNED | DRAFT | |
| AS-ENDO-001 | Heat-sensitive medication/endocrine flag | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | CDC_EXTREME_HEAT | `054b2f398848` | UNASSIGNED | DRAFT | |
| AS-PREG-004 | Pregnancy + heat | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACOG_804 | `4ba52bbc0661` | UNASSIGNED | DRAFT | |
| AS-NEURO-001 | MS + heat | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | NMSS_HEAT | `4892ba89b744` | UNASSIGNED | DRAFT | |
| AS-NEURO-002 | Seizure precautions | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | EPILEPSY_EXERCISE | `5e9391335641` | UNASSIGNED | DRAFT | |
| AS-NEURO-003 | Parkinson's / balance impairment | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | PARKINSON_EXERCISE | `60d8f06e1031` | UNASSIGNED | DRAFT | |
| AS-NEURO-006 | Fall-risk flag | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | CDC_STEADI | `7f797cf0757e` | UNASSIGNED | DRAFT | |
| AS-SYS-001 | Dialysis / fluid restriction | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | NKF_CKD_EXERCISE | `b7f2156d6d40` | UNASSIGNED | DRAFT | |
| AS-SYS-002 | Significant anemia | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | clinician-doc | `ca409005e7b8` | UNASSIGNED | DRAFT | |
| AS-SYS-003 | Fever / systemic illness current | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `ba124325372e` | UNASSIGNED | DRAFT | |
| AS-REC-004 | Compulsive-exercise pattern | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `ee0a33365878` | UNASSIGNED | DRAFT | |
| AS-AGE-002 | Frailty/balance flags | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | HHS_PAG_2018;CDC_STEADI | `0de207562dd6` | UNASSIGNED | DRAFT | |
| AS-AGE-003 | Age-flagged reduced heat tolerance | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | CDC_EXTREME_HEAT | `5b8b8e902e68` | UNASSIGNED | DRAFT | |
| AS-AGE-004 | Osteoporosis documented | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACSM_BONE_2004 | `3c123555cda9` | UNASSIGNED | DRAFT | |
| AS-ENV-004 | Extreme-caution heat + flags | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | NWS_HEAT_INDEX;CDC_EXTREME_HEAT | `a08726c72d1c` | UNASSIGNED | DRAFT | |
| AS-ENV-006 | AQI 151–200 | DEFER_OUTDOOR | caution | Pulmonologist/allergist or exercise physiologist with env-health expertise | EPA_AQI;EPA_AQ_ACTIVITY | `62079e0ebcf5` | UNASSIGNED | DRAFT | |
| AS-ENV-008 | Wind chill bands | MODIFY | caution | Licensed PT, certified exercise physiologist (CEP), or equivalent | NWS_WINDCHILL | `909ae9fd85c1` | UNASSIGNED | DRAFT | |
| AS-ENV-010 | Missing environmental data | INSUFFICIENT_DATA | caution | Any qualified clinician + product reviewer (data-sufficiency semantics) | PRODUCT-POLICY | `61138170f262` | UNASSIGNED | DRAFT | |

## P3

| Rule | Name | Effect | Severity | Required qualification | Evidence | Version hash | Assigned reviewer | Approval | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AS-CORE-004 | No diagnostic framing | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PARQ_PLUS | `046982ba8dfc` | UNASSIGNED | DRAFT | |
| AS-MSK-004 | Active rehab plan is input, not override | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | clinician-document | `cd4cb1d6a426` | UNASSIGNED | DRAFT | |
| AS-MSK-006 | DOMS only | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | DOMS_ACSM | `69ff47be408f` | UNASSIGNED | DRAFT | |
| AS-MSK-007 | Chronic joint pain / OA | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | HHS_PAG_2018;CDC_PA_ADULTS | `79df2f203c54` | UNASSIGNED | DRAFT | |
| AS-RESP-003 | Asthma + cold dry air | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | EPA_AQ_ACTIVITY | `90bffe945f78` | UNASSIGNED | DRAFT | |
| AS-DM-005 | Stable diabetes — no categorical prohibition | ALLOW | info | Any qualified clinician | ADA_PA_2016;CDC_PA_ADULTS | `653709b18791` | UNASSIGNED | DRAFT | |
| AS-PREG-001 | Uncomplicated pregnancy — activity encouraged | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACOG_804 | `6fda1c30b90c` | UNASSIGNED | DRAFT | |
| AS-PREG-005 | Postpartum return | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACOG_804 | `73f047d6593d` | UNASSIGNED | DRAFT | |
| AS-PREG-006 | Pregnancy never inferred | ALLOW | info | Any qualified clinician | PRODUCT-POLICY | `8ac0beb5426a` | UNASSIGNED | DRAFT | |
| AS-NEURO-004 | Wheelchair user — evaluate, never default-inactive | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | WHO_PA_2020;CDC_PA_ADULTS | `430bbb5fcfcc` | UNASSIGNED | DRAFT | |
| AS-SYS-004 | Immunosuppression exposure context | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | clinician-doc | `4f6fd8281320` | UNASSIGNED | DRAFT | |
| AS-SYS-005 | Cancer treatment fatigue | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | ACSM_CANCER_2019 | `2fecc2433919` | UNASSIGNED | DRAFT | |
| AS-REC-001 | Rest preference respected | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `b7b04529cf90` | UNASSIGNED | DRAFT | |
| AS-REC-002 | Poor sleep / high fatigue | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `2a0f551f877e` | UNASSIGNED | DRAFT | |
| AS-REC-003 | Repeated skips + distress | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `636d6bf3618b` | UNASSIGNED | DRAFT | |
| AS-AGE-001 | Age alone never disqualifies | ALLOW | info | Any qualified clinician | HHS_PAG_2018 | `4bd8253639f5` | UNASSIGNED | DRAFT | |
| AS-ENV-007 | AQI USG + sensitive | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | EPA_AQI | `8ce873a155b8` | UNASSIGNED | DRAFT | |
| AS-ENV-009 | UV ≥8 | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | EPA_UV | `769166fecdb5` | UNASSIGNED | DRAFT | |
| AS-ENV-011 | Stale observation | INSUFFICIENT_DATA | info | Any qualified clinician + product reviewer (data-sufficiency semantics) | PRODUCT-POLICY | `74f7bc07b486` | UNASSIGNED | DRAFT | |
| AS-ENV-012 | Ordinary rain | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `0ec726828026` | UNASSIGNED | DRAFT | |
| AS-PER-001 | Preference rank-boost | ALLOW | info | Any qualified clinician | PRODUCT-POLICY | `7fbfbbe3f1c4` | UNASSIGNED | DRAFT | |
| AS-PER-002 | Planned workout + adverse conditions | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `9102e2a01450` | UNASSIGNED | DRAFT | |
| AS-PER-003 | Rest day suppresses suggestions | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `d3490e71e741` | UNASSIGNED | DRAFT | |
| AS-PER-004 | Forecast better-time offer | MODIFY | info | Licensed PT, certified exercise physiologist (CEP), or equivalent | PRODUCT-POLICY | `1b4f6d1cba0a` | UNASSIGNED | DRAFT | |
| AS-PER-005 | No calorie-compensation framing | ALLOW | info | Any qualified clinician | PRODUCT-POLICY | `865aa165e20c` | UNASSIGNED | DRAFT | |

## Assignment instructions (human action required)

No fictional reviewers are assigned. To begin review:

1. A person with hiring/clinical authority fills the "Assigned reviewer" column
   with a real, verifiable reviewer identity and credential (e.g. license no.).
2. Assignment order: P1 rows top-down, then P2, then P3.
3. Each row's "Approval" stays DRAFT until the reviewer signs the adjudication
   queue entry AND an authorized engineer records APPROVED in the DB with the
   required fields — never by editing this file.
4. Rules whose Evidence is PRODUCT-POLICY (`product_default` class) still need
   sign-off — they encode safety-behavior policy a clinician must sanity-check.

Counts: P1 16 rules · P2 30 · P3 25 · total 71.
