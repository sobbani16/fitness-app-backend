# Rule-by-Rule Validation Audit (Phase 16.2)

Generated 2026-11-22T04:24:49.532Z — automated behavioral + evidence-linkage analysis only.
**No entry below constitutes clinical approval. All 71 rules remain DRAFT.**

Summary: 65 reachable · 4 intentional URGENT mirrors · 2 unsupported-input · 0 inert-defects · 29 require physician/specialist tier.

## AS-CORE-001 — Urgent symptom escalation
- dimension: medical · effect: URGENT_ESCALATION · severity: high · reachability: **intentional-mirror**
- executable example: seated_movement → URGENT_ESCALATION (fired: false)
- triggers: `symptomCodes:chest_pain` `symptomCodes:chest_pressure` `symptomCodes:syncope` `symptomCodes:dyspnea_unusual` `symptomCodes:numbness_neuro` `symptomCodes:pregnancy_bleeding` `symptomCodes:pregnancy_contractions` `symptomCodes:pregnancy_fluid_leak` `symptomCodes:pregnancy_calf_pain` `symptomCodes:vision_changes` `symptomCodes:severe_headache_sudden`
- input channel(s): symptomCodes
- co-fires with: [object Object], [object Object], [object Object], [object Object]
- evidence: ACSM_SCREEN_2015 (ACSM) · PARQ_PLUS (PAR-Q+) · ACOG_804 (ACOG)
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
  - PAR-Q+: PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment. [tier: clinical-exercise-physiologist]
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: structural-urgent-mirror: short-circuit precedes rule eval — by design; cannot appear in ruleIds
- purpose: Reported symptom may require urgent medical attention — activity suggestions suppressed.

## AS-CORE-002 — Documented prohibition respected
- dimension: medical · effect: BLOCK_ACTIVITY · severity: high · reachability: **reachable**
- executable example: seated_movement → BLOCK_ACTIVITY (fired: true)
- triggers: `restrictionCategories:__match_activity__`
- input channel(s): restrictionCategories
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: A documented activity prohibition cannot be overridden by goals, fitness scores, or weather.

## AS-CORE-003 — Unknown screening with risk flags
- dimension: medical · effect: INSUFFICIENT_DATA · severity: caution · reachability: **reachable**
- executable example: seated_movement → INSUFFICIENT_DATA (fired: true)
- triggers: `profileFlags:screening_incomplete+risk_flags_present`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- requiredData (missing → conservative): health_screening
- evidence: ACSM_SCREEN_2015 (ACSM) · PARQ_PLUS (PAR-Q+)
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
  - PAR-Q+: PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment. [tier: clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Screening status unknown with risk indicators — light activity only pending profile completion.

## AS-CORE-004 — No diagnostic framing
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:__always__`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- co-fires with: [object Object], [object Object]
- evidence: PARQ_PLUS (PAR-Q+)
  - PAR-Q+: PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment. [tier: clinical-exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: always-fires info marker — verify it never escalates a decision
- purpose: Wording constraint: never present a symptom questionnaire as a diagnosis.

## AS-MSK-001 — Non-weight-bearing order
- dimension: functional · effect: BLOCK_ACTIVITY · severity: high · reachability: **reachable**
- executable example: outdoor_walk → BLOCK_ACTIVITY (fired: true)
- triggers: `profileFlags:wb_non_weight_bearing` `activityCategories:weight_bearing_lower`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: APTA_ANKLE_2021 (APTA/JOSPT)
  - APTA/JOSPT: JOSPT ankle instability/return-to-sport guidance — non-weight-bearing and graded-loading framing; verify thresholds. [tier: sports-physio-or-physician]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Active non-weight-bearing restriction on the affected limb.

## AS-MSK-002 — Acute injury ≤72h
- dimension: functional · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:acute_injury_72h`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: APTA_ANKLE_2021 (APTA/JOSPT)
  - APTA/JOSPT: JOSPT ankle instability/return-to-sport guidance — non-weight-bearing and graded-loading framing; verify thresholds. [tier: sports-physio-or-physician]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: threshold-bearing — numeric trigger needs specialist signoff vs guidance bands
- purpose: Acute injury window — defer to non-affected modalities per documented guidance.

## AS-MSK-003 — Joint instability
- dimension: functional · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: gentle_mobility → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `profileFlags:joint_instability` `activityCategories:balance_challenging` `activityCategories:impact`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: APTA_ANKLE_2021 (APTA/JOSPT)
  - APTA/JOSPT: JOSPT ankle instability/return-to-sport guidance — non-weight-bearing and graded-loading framing; verify thresholds. [tier: sports-physio-or-physician]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Documented joint instability — avoid cutting/impact on that joint.

## AS-MSK-004 — Active rehab plan is input, not override
- dimension: functional · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:rehab_plan_active`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: clinician-document (clinician)
  - clinician: Clinician-documented input — rule acts on clinician-entered restriction data. [tier: documenting-clinician]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Follow the documented rehabilitation phase — never extend beyond it.

## AS-MSK-005 — Severe undiagnosed pain / post-fall
- dimension: functional · effect: NEEDS_CLINICAL_REVIEW · severity: high · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `profileFlags:severe_undiagnosed_pain` `profileFlags:post_fall_pain`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Severe pain, inability to bear weight, or post-fall pain needs evaluation first.

## AS-MSK-006 — DOMS only
- dimension: functional · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `symptomCodes:muscle_soreness_doms`
- input channel(s): symptomCodes
- evidence: DOMS_ACSM (ACSM)
  - ACSM: ACSM DOMS position content — delayed-onset soreness ≠ injury; verify MODIFY-vs-ALLOW calibration. [tier: clinical-exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Benign soreness — lighter intensity, never labeled an injury.

## AS-MSK-007 — Chronic joint pain / OA
- dimension: functional · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:osteoarthritis` `activityCategories:impact`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: HHS_PAG_2018 (HHS) · CDC_PA_ADULTS (CDC/HHS)
  - HHS: HHS Physical Activity Guidelines 2nd ed (2018) — general guidance + older-adult balance framing. [tier: qualified-exercise-professional]
  - CDC/HHS: US physical-activity guidelines — general volume framing; verify no over-restriction of appropriate activity. [tier: qualified-exercise-professional]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Joint symptoms — favor lower-impact options; never prohibit walking outright.

## AS-MSK-008 — Post-surgical, undocumented restrictions
- dimension: functional · effect: NEEDS_CLINICAL_REVIEW · severity: high · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `profileFlags:post_surgical_undocumented`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- requiredData (missing → conservative): surgical_restrictions
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Recovery without documented clearance — never inferred from elapsed time.

## AS-CV-001 — Unexplained chest pain / recent cardiac event
- dimension: medical · effect: URGENT_ESCALATION · severity: high · reachability: **intentional-mirror**
- executable example: seated_movement → URGENT_ESCALATION (fired: false)
- triggers: `symptomCodes:chest_pain` `symptomCodes:chest_pressure`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: ACSM_SCREEN_2015 (ACSM)
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: structural-urgent-mirror: short-circuit precedes rule eval — by design; cannot appear in ruleIds
- purpose: Chest pain requires urgent medical attention — do not begin a workout.

## AS-CV-002 — Stable CAD / completed rehab
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:cad` `conditionKeys:cardiac_rehab` `activityCategories:vigorous`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: AHA_RESISTANCE_CVD (AHA) · ACSM_SCREEN_2015 (ACSM)
  - AHA: AHA scientific statement on resistance exercise in CVD — Valsalva/BP-response precautions. [tier: physician]
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Stable cardiac condition — moderate intensity per rehabilitation guidance; screen intensity increases.

## AS-CV-003 — Uncontrolled hypertension
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `profileFlags:hypertension_uncontrolled` `activityCategories:vigorous` `activityCategories:valsalva`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: ACSM_SCREEN_2015 (ACSM)
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Documented uncontrolled hypertension — follow clinician guidance scope.

## AS-CV-004 — Syncope/dizziness current vs history
- dimension: medical · effect: NEEDS_CLINICAL_REVIEW · severity: high · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `symptomCodes:syncope` `symptomCodes:dizziness`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: PARQ_PLUS (PAR-Q+) · ACSM_SCREEN_2015 (ACSM)
  - PAR-Q+: PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment. [tier: clinical-exercise-physiologist]
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Current dizziness/syncope symptoms should be reviewed before exertion.

## AS-CV-005 — Stable heart failure
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:heart_failure` `activityCategories:vigorous`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: AHA statement (AHA)
  - AHA: Generic AHA statement ref — reviewer must identify the specific statement for this rule. [tier: physician]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Stable heart failure — supervised/moderate activity per rehab guidance.

## AS-RESP-001 — Asthma/EIB + USG AQI
- dimension: medical · effect: DEFER_OUTDOOR · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `conditionKeys:asthma` `conditionKeys:eib` `envHazards:aqi_usg` `envHazards:aqi_unhealthy` `envHazards:aqi_hazardous` `activityCategories:outdoor_exposed`
- input channel(s): conditionKeys | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: EPA_AQI (EPA) · EPA_AQ_ACTIVITY (EPA)
  - EPA: US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService. [tier: exercise-physiologist]
  - EPA: EPA/AirNow activity guidance per AQI band — verify outdoor deferral bands. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Air quality may aggravate respiratory symptoms — indoor option or postpone.

## AS-RESP-002 — Asthma + wildfire smoke
- dimension: medical · effect: DEFER_OUTDOOR · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `conditionKeys:asthma` `conditionKeys:eib` `envHazards:smoke` `envHazards:aqi_unhealthy` `envHazards:aqi_hazardous` `activityCategories:outdoor_exposed`
- input channel(s): conditionKeys | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: EPA_WILDFIRE (EPA)
  - EPA: EPA wildfire-smoke/AQI guidance — verify smoke-hazard behavior vs AQI bands. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Smoke exposure deferred per EPA wildfire guidance.

## AS-RESP-003 — Asthma + cold dry air
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `conditionKeys:asthma` `conditionKeys:eib` `envHazards:cold_caution` `envHazards:cold_danger` `activityCategories:outdoor_exposed`
- input channel(s): conditionKeys | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: EPA_AQ_ACTIVITY (EPA)
  - EPA: EPA/AirNow activity guidance per AQI band — verify outdoor deferral bands. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Cold air can trigger symptoms — warm up, cover, shorten exposure.

## AS-RESP-004 — Active respiratory infection
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `symptomCodes:fever` `symptomCodes:systemic_illness`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Active illness — conservative modification pending clinical review of fever rules.

## AS-RESP-005 — Unexplained breathlessness
- dimension: medical · effect: URGENT_ESCALATION · severity: high · reachability: **intentional-mirror**
- executable example: seated_movement → URGENT_ESCALATION (fired: false)
- triggers: `symptomCodes:severe_dyspnea` `symptomCodes:dyspnea_unusual`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: PARQ_PLUS (PAR-Q+) · ACSM_SCREEN_2015 (ACSM)
  - PAR-Q+: PAR-Q+ 2021 evidence-based screening — general readiness gating; verify wording alignment. [tier: clinical-exercise-physiologist]
  - ACSM: ACSM preparticipation screening update (Riebe 2015) — urgent-symptom referral; reviewer verifies symptom list vs current ACSM algorithm. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: structural-urgent-mirror: short-circuit precedes rule eval — by design; cannot appear in ruleIds
- purpose: Unusual shortness of breath may require urgent attention.

## AS-RESP-006 — AQI bands (general)
- dimension: medical · effect: DEFER_OUTDOOR · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:aqi_unhealthy` `envHazards:aqi_hazardous` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object]
- evidence: EPA_AQI (EPA)
  - EPA: US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Unhealthy AQI — outdoor exertion deferred per EPA guidance.

## AS-DM-001 — Insulin-treated diabetes + recent hypoglycemia
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `profileFlags:hypoglycemia_risk` `profileFlags:recent_hypoglycemia` `activityCategories:vigorous`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: ADA_PA_2016 (ADA)
  - ADA: ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats. [tier: physician-or-CDE]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Recent hypoglycemia — pre-activity glucose check and carbs-available per ADA; never dose insulin.

## AS-DM-002 — Hyperglycemia + ketones
- dimension: unknown · effect: DEFER_OUTDOOR · severity: high · reachability: **reachable**
- executable example: outdoor_run → DEFER_OUTDOOR (fired: true)
- triggers: `profileFlags:hyperglycemia_ketones` `activityCategories:vigorous`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: ADA_PA_2016 (ADA)
  - ADA: ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats. [tier: physician-or-CDE]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Vigorous activity with ketones present can worsen status — defer until resolved.

## AS-DM-003 — Peripheral neuropathy / foot ulcer history
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:neuropathy` `activityCategories:impact` `activityCategories:weight_bearing_lower`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: ADA_PA_2016 (ADA)
  - ADA: ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats. [tier: physician-or-CDE]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Foot complications — foot checks and reduced-impact options.

## AS-DM-004 — Proliferative retinopathy
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:retinopathy` `activityCategories:impact` `activityCategories:valsalva`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: ADA_PA_2016 (ADA)
  - ADA: ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats. [tier: physician-or-CDE]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Avoid jarring/straining per ADA guidance.

## AS-DM-005 — Stable diabetes — no categorical prohibition
- dimension: unknown · effect: ALLOW · severity: info · reachability: **reachable**
- executable example: seated_movement → ALLOW (fired: true)
- triggers: `conditionKeys:diabetes_t1` `conditionKeys:diabetes_t2`
- input channel(s): conditionKeys
- evidence: ADA_PA_2016 (ADA) · CDC_PA_ADULTS (CDC/HHS)
  - ADA: ADA position statement: physical activity/exercise and diabetes (2016) — hypoglycemia risk windows, foot care, retinopathy caveats. [tier: physician-or-CDE]
  - CDC/HHS: US physical-activity guidelines — general volume framing; verify no over-restriction of appropriate activity. [tier: qualified-exercise-professional]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: threshold-bearing — numeric trigger needs specialist signoff vs guidance bands
- purpose: Stable diabetes without complications does not prohibit activity.

## AS-ENDO-001 — Heat-sensitive medication/endocrine flag
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `profileFlags:heat_sensitivity` `envHazards:heat_extreme_caution` `envHazards:heat_danger` `activityCategories:outdoor_exposed`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: CDC_EXTREME_HEAT (CDC)
  - CDC: CDC extreme-heat guidance — verify apparent-temp thresholds + population exclusions. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Heat sensitivity — timing/shade/hydration precautions (no prescriptive amounts).

## AS-PREG-001 — Uncomplicated pregnancy — activity encouraged
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: contact_sport → MODIFY (fired: true)
- triggers: `profileFlags:pregnancy` `activityCategories:contact_fall_risk` `activityCategories:supine_prolonged`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: ACOG_804 (ACOG)
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Pregnancy is not an activity ban; avoid documented supine-prolonged/contact-fall patterns.

## AS-PREG-002 — Pregnancy warning symptoms
- dimension: medical · effect: URGENT_ESCALATION · severity: high · reachability: **intentional-mirror**
- executable example: seated_movement → URGENT_ESCALATION (fired: false)
- triggers: `symptomCodes:pregnancy_bleeding` `symptomCodes:pregnancy_contractions` `symptomCodes:pregnancy_fluid_leak` `symptomCodes:pregnancy_calf_pain`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: ACOG_804 (ACOG)
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- flags: structural-urgent-mirror: short-circuit precedes rule eval — by design; cannot appear in ruleIds
- purpose: Pregnancy warning sign — stop activity and seek care.

## AS-PREG-003 — High-risk pregnancy documented restriction
- dimension: medical · effect: NEEDS_CLINICAL_REVIEW · severity: high · reachability: **reachable**
- executable example: seated_movement → BLOCK_ACTIVITY (fired: true)
- triggers: `profileFlags:pregnancy_high_risk` `restrictionCategories:__any__`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | restrictionCategories
- evidence: ACOG_804 (ACOG)
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Documented pregnancy restriction — follow clinician instruction exactly.

## AS-PREG-004 — Pregnancy + heat
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `profileFlags:pregnancy` `envHazards:heat_extreme_caution` `envHazards:heat_danger` `envHazards:heat_sensitive_danger` `activityCategories:outdoor_exposed`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: ACOG_804 (ACOG)
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Overheating precaution per ACOG — cooler hours/indoor.

## AS-PREG-005 — Postpartum return
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `profileFlags:postpartum` `activityCategories:vigorous` `activityCategories:impact`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: ACOG_804 (ACOG)
  - ACOG: ACOG Committee Opinion 804 (2020) physical activity in pregnancy/postpartum — absolute+relative contraindications; verify each trigger against the table. [tier: obstetric-specialist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Gradual return; surgical recovery per clinician; pelvic-floor symptoms → review.

## AS-PREG-006 — Pregnancy never inferred
- dimension: medical · effect: ALLOW · severity: info · reachability: **reachable**
- executable example: seated_movement → ALLOW (fired: true)
- triggers: `profileFlags:__always__`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- co-fires with: [object Object], [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: always-fires info marker — verify it never escalates a decision
- purpose: Pregnancy status is a voluntary profile field — never inferred from other data.

## AS-NEURO-001 — MS + heat
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `conditionKeys:ms` `envHazards:heat_extreme_caution` `envHazards:heat_danger` `activityCategories:outdoor_exposed`
- input channel(s): conditionKeys | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: NMSS_HEAT (NMSS)
  - NMSS: National MS Society heat-sensitivity guidance (Uhthoff) — temperature thresholds need specialist check. [tier: physician/neurology]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Heat sensitivity with MS — cooling, timing, indoor alternatives.

## AS-NEURO-002 — Seizure precautions
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: swimming → MODIFY (fired: true)
- triggers: `conditionKeys:seizure` `activityCategories:water_immersion` `activityCategories:balance_challenging`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: EPILEPSY_EXERCISE (ILAE/specialist)
  - ILAE/specialist: Exercise & epilepsy consensus guidance — seizure-trigger precautions; specialist review required. [tier: physician/neurology]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Seizure history — supervision/buddy guidance for water and heights; never prohibit.

## AS-NEURO-003 — Parkinson's / balance impairment
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: gentle_mobility → MODIFY (fired: true)
- triggers: `conditionKeys:parkinsons` `activityCategories:balance_challenging` `activityCategories:impact`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: PARKINSON_EXERCISE (specialist)
  - specialist: Parkinson disease exercise guidance — balance/gait precautions; specialist review. [tier: physician/neurology]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Balance impairment — supported/assistive adaptations.

## AS-NEURO-004 — Wheelchair user — evaluate, never default-inactive
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:wheelchair`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: WHO_PA_2020 (WHO) · CDC_PA_ADULTS (CDC/HHS)
  - WHO: WHO 2020 guidelines on physical activity & sedentary behaviour — verify volume framing per population. [tier: qualified-exercise-professional]
  - CDC/HHS: US physical-activity guidelines — general volume framing; verify no over-restriction of appropriate activity. [tier: qualified-exercise-professional]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Evaluate accessible candidates (upper-body/seated/adapted) — never default to no activity.

## AS-NEURO-005 — Stroke recovery undocumented
- dimension: medical · effect: NEEDS_CLINICAL_REVIEW · severity: caution · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `conditionKeys:stroke_recovery`
- input channel(s): conditionKeys
- requiredData (missing → conservative): rehab_plan
- evidence: clinician-doc (clinician)
  - clinician: Clinician-documented input — rule acts on clinician-entered restriction data. [tier: documenting-clinician]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Stroke recovery follows the rehab plan; undocumented → review.

## AS-NEURO-006 — Fall-risk flag
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `profileFlags:fall_risk` `envHazards:heavy_precip` `envHazards:cold_caution` `envHazards:high_wind`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | envHazards
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: CDC_STEADI (CDC)
  - CDC: CDC STEADI fall-risk screening — balance/fall-risk activity precautions for older adults. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Fall risk — environment-aware footing caution.

## AS-SYS-001 — Dialysis / fluid restriction
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `conditionKeys:dialysis` `conditionKeys:ckd` `profileFlags:fluid_restriction`
- input channel(s): conditionKeys | derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: NKF_CKD_EXERCISE (NKF)
  - NKF: National Kidney Foundation exercise guidance for CKD — dialysis-day and access-site precautions. [tier: physician/nephrology]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Fluid restriction documented — no generic hydration targets.

## AS-SYS-002 — Significant anemia
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:anemia` `activityCategories:vigorous`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: clinician-doc (clinician)
  - clinician: Clinician-documented input — rule acts on clinician-entered restriction data. [tier: documenting-clinician]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Documented anemia — follow clinician guidance scope.

## AS-SYS-003 — Fever / systemic illness current
- dimension: medical · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: seated_movement → NEEDS_CLINICAL_REVIEW (fired: true)
- triggers: `symptomCodes:fever` `symptomCodes:systemic_illness`
- input channel(s): symptomCodes
- co-fires with: [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Active systemic illness — defer exertion until recovered.

## AS-SYS-004 — Immunosuppression exposure context
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: group_fitness_class → MODIFY (fired: true)
- triggers: `conditionKeys:immunosuppressed` `activityCategories:group_indoor`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: clinician-doc (clinician)
  - clinician: Clinician-documented input — rule acts on clinician-entered restriction data. [tier: documenting-clinician]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Immunosuppression — exposure-context caution.

## AS-SYS-005 — Cancer treatment fatigue
- dimension: medical · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `conditionKeys:cancer_treatment`
- input channel(s): conditionKeys
- evidence: ACSM_CANCER_2019 (ACSM)
  - ACSM: ACSM roundtable on exercise for cancer survivors (2019) — fatigue/lymphedema/immunosuppression precautions. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Treatment-related fatigue — fatigue-adapted options; rest is valid.

## AS-REC-001 — Rest preference respected
- dimension: personalization · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:rest_requested`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: User chose rest — no reframing, no guilt, no calorie compensation.

## AS-REC-002 — Poor sleep / high fatigue
- dimension: personalization · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `profileFlags:high_fatigue` `profileFlags:poor_sleep` `activityCategories:vigorous`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Lighter option offered without obligation.

## AS-REC-003 — Repeated skips + distress
- dimension: personalization · effect: MODIFY · severity: info · reachability: **unsupported**
- executable example: seated_movement → ALLOW (fired: false)
- triggers: `profileFlags:distress_signals`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: UNSUPPORTED_INPUT: no validated collection path — intentionally inactive
- purpose: Soften suggestions; supportive copy only — never diagnose.

## AS-REC-004 — Compulsive-exercise pattern
- dimension: personalization · effect: MODIFY · severity: caution · reachability: **unsupported**
- executable example: seated_movement → ALLOW (fired: false)
- triggers: `profileFlags:compulsive_pattern_flags`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: UNSUPPORTED_INPUT: no validated collection path — intentionally inactive
- purpose: Unverified pattern flags — soften suggestions; queued for clinical review.

## AS-AGE-001 — Age alone never disqualifies
- dimension: unknown · effect: ALLOW · severity: info · reachability: **reachable**
- executable example: seated_movement → ALLOW (fired: true)
- triggers: `profileFlags:age_65_plus`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- co-fires with: [object Object]
- evidence: HHS_PAG_2018 (HHS)
  - HHS: HHS Physical Activity Guidelines 2nd ed (2018) — general guidance + older-adult balance framing. [tier: qualified-exercise-professional]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: threshold-bearing — numeric trigger needs specialist signoff vs guidance bands
- purpose: Age alone does not disqualify outdoor activity.

## AS-AGE-002 — Frailty/balance flags
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: gentle_mobility → MODIFY (fired: true)
- triggers: `profileFlags:frailty` `profileFlags:fall_risk` `activityCategories:balance_challenging` `activityCategories:impact`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- co-fires with: [object Object]
- evidence: HHS_PAG_2018 (HHS) · CDC_STEADI (CDC)
  - HHS: HHS Physical Activity Guidelines 2nd ed (2018) — general guidance + older-adult balance framing. [tier: qualified-exercise-professional]
  - CDC: CDC STEADI fall-risk screening — balance/fall-risk activity precautions for older adults. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Balance-aware adaptation plus strength emphasis.

## AS-AGE-003 — Age-flagged reduced heat tolerance
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `profileFlags:age_65_plus` `envHazards:heat_extreme_caution` `envHazards:heat_danger` `activityCategories:outdoor_exposed`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: CDC_EXTREME_HEAT (CDC)
  - CDC: CDC extreme-heat guidance — verify apparent-temp thresholds + population exclusions. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: threshold-bearing — numeric trigger needs specialist signoff vs guidance bands
- purpose: Reduced heat tolerance — cooler hours/hydration cues.

## AS-AGE-004 — Osteoporosis documented
- dimension: unknown · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_run → MODIFY (fired: true)
- triggers: `conditionKeys:osteoporosis` `activityCategories:impact`
- input channel(s): conditionKeys | activity catalog demand match
- evidence: ACSM_BONE_2004 (ACSM)
  - ACSM: ACSM position stand on physical activity & bone health — osteoporosis loading/fracture-risk framing; verify flexion/rotation restrictions vs current guidance. [tier: physician-or-clinical-exercise-physiologist]
- reviewer tier: physician/specialist · missing-data: conservative
- purpose: Bone-loading precautions per ACSM.

## AS-ENV-001 — Thunderstorm
- dimension: environmental · effect: DEFER_OUTDOOR · severity: high · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:thunderstorm` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object]
- evidence: NWS_LIGHTNING (NWS)
  - NWS: NWS lightning-safety guidance ("when thunder roars, go indoors"). [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Lightning risk — exposed outdoor deferred (NWS).

## AS-ENV-002 — Severe alert active
- dimension: environmental · effect: DEFER_OUTDOOR · severity: high · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:severe_alert` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- evidence: NWS (NWS)
  - NWS: National Weather Service alert severity semantics. [tier: engineering-verified]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Active severe-weather alert.

## AS-ENV-003 — Heat index danger
- dimension: environmental · effect: DEFER_OUTDOOR · severity: high · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:heat_danger` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: NWS_HEAT_INDEX (NWS)
  - NWS: NWS heat-index bands (caution/extreme caution/danger/extreme danger) — verify mapping. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: NWS danger band — outdoor exertion deferred.

## AS-ENV-004 — Extreme-caution heat + flags
- dimension: environmental · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `envHazards:heat_extreme_caution` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: NWS_HEAT_INDEX (NWS) · CDC_EXTREME_HEAT (CDC)
  - NWS: NWS heat-index bands (caution/extreme caution/danger/extreme danger) — verify mapping. [tier: exercise-physiologist]
  - CDC: CDC extreme-heat guidance — verify apparent-temp thresholds + population exclusions. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Extreme-caution heat band — cooler hours/shorter/indoor.

## AS-ENV-005 — AQI ≥201
- dimension: environmental · effect: DEFER_OUTDOOR · severity: high · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:aqi_hazardous` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object]
- evidence: EPA_AQI (EPA)
  - EPA: US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Very unhealthy/hazardous AQI — outdoor deferred.

## AS-ENV-006 — AQI 151–200
- dimension: environmental · effect: DEFER_OUTDOOR · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:aqi_unhealthy` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object]
- evidence: EPA_AQI (EPA) · EPA_AQ_ACTIVITY (EPA)
  - EPA: US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService. [tier: exercise-physiologist]
  - EPA: EPA/AirNow activity guidance per AQI band — verify outdoor deferral bands. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Unhealthy AQI — outdoor exertion deferred.

## AS-ENV-007 — AQI USG + sensitive
- dimension: environmental · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `envHazards:aqi_usg` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object]
- evidence: EPA_AQI (EPA)
  - EPA: US AQI bands (101–150 USG, 151–200 unhealthy, 201+ very unhealthy) + AirNow activity guidance; verify band edges used by environmentService. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: USG AQI with sensitivity flags — shorten/lighter/indoor.

## AS-ENV-008 — Wind chill bands
- dimension: environmental · effect: MODIFY · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:cold_danger` `envHazards:cold_caution` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object], [object Object]
- evidence: NWS_WINDCHILL (NWS)
  - NWS: NWS windchill frostbite-time bands — verify threshold mapping. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Cold exposure bands — frostbite risk precautions.

## AS-ENV-009 — UV ≥8
- dimension: environmental · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `envHazards:uv_extreme` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- evidence: EPA_UV (EPA)
  - EPA: EPA UV-index exposure guidance. [tier: exercise-physiologist]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Very high UV — timing/shade guidance.

## AS-ENV-010 — Missing environmental data
- dimension: environmental · effect: INSUFFICIENT_DATA · severity: caution · reachability: **reachable**
- executable example: outdoor_walk → INSUFFICIENT_DATA (fired: true)
- triggers: `profileFlags:env_unknown` `activityCategories:outdoor_exposed`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- requiredData (missing → conservative): environmental_observation
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: No outdoor-safety claim is made when conditions cannot be verified.

## AS-ENV-011 — Stale observation
- dimension: environmental · effect: INSUFFICIENT_DATA · severity: info · reachability: **reachable**
- executable example: outdoor_walk → INSUFFICIENT_DATA (fired: true)
- triggers: `profileFlags:env_stale` `activityCategories:outdoor_exposed`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | activity catalog demand match
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Stale data is never the basis of a safety claim.

## AS-ENV-012 — Ordinary rain
- dimension: environmental · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `envHazards:heavy_precip` `activityCategories:outdoor_exposed`
- input channel(s): envHazards | activity catalog demand match
- co-fires with: [object Object], [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Rain alone is not a contraindication — caution note only.

## AS-PER-001 — Preference rank-boost
- dimension: personalization · effect: ALLOW · severity: info · reachability: **reachable**
- executable example: seated_movement → ALLOW (fired: true)
- triggers: `profileFlags:preference_match`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Preference-matched eligible activities rank first.

## AS-PER-002 — Planned workout + adverse conditions
- dimension: personalization · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → MODIFY (fired: true)
- triggers: `profileFlags:workout_planned` `envHazards:__any__`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags | envHazards
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Offer indoor/timing alternative while keeping the plan the user's choice.

## AS-PER-003 — Rest day suppresses suggestions
- dimension: personalization · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: seated_movement → MODIFY (fired: true)
- triggers: `profileFlags:rest_day`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Rest day — suggestions suppressed entirely.

## AS-PER-004 — Forecast better-time offer
- dimension: personalization · effect: MODIFY · severity: info · reachability: **reachable**
- executable example: outdoor_walk → DEFER_OUTDOOR (fired: true)
- triggers: `envHazards:heat_danger` `envHazards:heat_extreme_caution` `envHazards:heat_sensitive_danger` `envHazards:thunderstorm` `envHazards:heavy_precip` `envHazards:cold_danger`
- input channel(s): envHazards
- co-fires with: [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object], [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- purpose: Offer a time-shift only when forecast data supports it.

## AS-PER-005 — No calorie-compensation framing
- dimension: personalization · effect: ALLOW · severity: info · reachability: **reachable**
- executable example: seated_movement → ALLOW (fired: true)
- triggers: `profileFlags:__always__`
- input channel(s): derived flags (conditions/pregnancy/age/wheelchair/med-flags) + caller flags
- co-fires with: [object Object], [object Object]
- evidence: PRODUCT-POLICY (internal)
  - internal: Engineering policy marker — no external clinical claim; still requires reviewer signoff on the policy itself. [tier: product+clinical]
- reviewer tier: qualified-exercise-professional · missing-data: conservative
- flags: always-fires info marker — verify it never escalates a decision
- purpose: No suggestion is framed as food compensation.

## Machine-readable artifact

docs/audits/activity-safety-rule-audit.json — same data, consumable by the reviewer workflow.
