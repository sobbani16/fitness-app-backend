# 03 — 40-Condition Evidence Matrix

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Research date:** 2026-11-22
**Method:** Peer-verified clinical guidelines + landmark trials. Full citations in `17-EVIDENCE-SOURCE-REGISTER.md`. Claim classes: PREVENTION / RISK-REDUCTION / SYMPTOM / FUNCTION / CONTROL / REMISSION / SUPPORTIVE-ONLY.
**Humai columns** use: ✅ works · ⚠️ partial · ❌ missing.

---

## GROUP A — Metabolic & hormonal

### A1. Fatty liver / MASLD
| Field | Value |
|---|---|
| Clinical meaning | Hepatic steatosis with cardiometabolic risk; spectrum to MASH/fibrosis |
| Lifestyle claim class | **CONTROL → remission of steatosis/NASH possible**; fibrosis regression at high weight loss |
| Evidence | AGA CPU 2021 + AASLD Guidance 2023: ≥5% wt loss ↓steatosis; ≥7% NASH resolution; ≥10% fibrosis improvement; Mediterranean diet; ↓fructose/SFA; 150–300 min/wk aerobic + resistance complementary. **STRONG** |
| Interventions | Weight loss (lean MASLD: 3–5%), Mediterranean pattern, exercise, alcohol limitation, no SSB |
| Harm risk | Overly aggressive deficits; alcohol guidance errors in advanced disease |
| Meds | GLP-1/pioglitazone may help MASH — nutrition guidance must not conflict |
| Monitoring | Weight, waist, ALT/AST (clinician), FIB-4 (clinician) |
| Referral triggers | FIB-4 ≥1.3, known fibrosis ≥F2, cirrhosis signs |
| Humai | Condition ❌ (not in DB) · nutrition ⚠️ · exercise ⚠️ (little cardio) |
| Verdict | **NEEDS_DATA_REMEDIATION + clinical review of rules** |

### A2. Insulin resistance
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION / CONTROL — progression to T2D preventable (DPP −58%) |
| Evidence | ADA SoC 2025 §3 (DPP: ≥7% weight loss + ≥150min/wk, evidence A) |
| Humai | ❌ condition absent; prediabetes row exists (adjacent) |
| Verdict | **NEEDS_DATA_REMEDIATION** — fold into prediabetes pathway w/ A1c/FG monitoring |

### A3. Prediabetes
| Field | Value |
|---|---|
| Claim class | **PREVENTION of T2D (strong)** — remission of prediabetes (normoglycemia) achievable |
| Evidence | ADA SoC 2025 §3.3–3.6; DPP 58% RR reduction; Mediterranean/low-carb patterns acceptable (B) |
| Interventions | Weight loss ≥7%, ≥150min/wk moderate activity, fiber, whole grains; no single mandated diet |
| Meds | Metformin consideration is clinician's |
| Monitoring | A1c/FPG annually |
| Humai | Condition ✅ (DB row) · rules ❌ (0 for prediabetes) |
| Verdict | **NEEDS_ENGINEERING_REMEDIATION + rules authoring** — P1 candidate |

### A4. Type 2 diabetes
| Field | Value |
|---|---|
| Claim class | CONTROL; **REMISSION possible in subset** — DiRECT: 46% remission @1yr (86% if >15kg loss); requires sustained weight loss, early disease, no insulin |
| Evidence | DiRECT Lancet 2018; ADA SoC 2025 (remission definition A1c<6.5% ≥3mo off meds — ADA 2021 consensus) |
| Interventions | Structured weight management, carb quality/quantity awareness, activity, post-meal walks |
| Harms | **Hypoglycemia on insulin/SU — activity fueling + meal-timing safety REQUIRED; currently unmodelable (no med model)** |
| Monitoring | A1c q3–6mo; glucose data (clinician); hypoglycemia episodes |
| Referral | Insulin/SU use, complications, hypoglycemia unawareness, pregnancy |
| Humai | ✅ row; rules DRAFT w/ blanket HIGH_SUGAR block (over-blocks fruit) |
| Verdict | **NEEDS_CLINICAL_REVIEW + medication model; education-only for insulin-treated until then** |

### A5. Obesity
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION/CONTROL — 5–10% loss → meaningful metabolic gains |
| Evidence | ADA, AGA CPU, 2013 AHA/ACC/TOS obesity guideline; Look AHEAD (fitness+weight loss improves function/QoL) |
| Interventions | Deficit diet + activity + behavioral support; protein adequacy during loss; resistance training to preserve lean mass |
| Harms | Aggressive deficits, ED risk screening absent (calorieSafety `ed_risk` exists, unwired) |
| Humai | ❌ no condition row (BMI in profile); calorie targets work |
| Verdict | **READY after condition modeling** — P1 anchor |

### A6. High triglycerides
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION/CONTROL |
| Evidence | AHA/ACC 2018/2026 cholesterol guideline — TG management via weight loss, ↓alcohol, ↓refined carbs/added sugars, omega-3s (prescription context); severe TG ≥500 → pancreatitis prevention (medical) |
| Humai | ✅ row exists (Hypertriglyceridemia); ❌ no rules |
| Verdict | **NEEDS_CLINICAL_REVIEW** — alcohol/abstinence advice needs care; severe TG is medical |

### A7. Elevated LDL cholesterol
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION |
| Evidence | AHA/ACC cholesterol guideline — SFA <7% kcal (TLC), fiber, plant sterols context; statin decisions are clinical |
| Humai | ✅ row (High LDL Cholesterol); ❌ no rules; sat-fat data on only 18 ingredients |
| Verdict | **NEEDS_DATA_REMEDIATION** (sat-fat coverage) — P2 |

### A8. Metabolic syndrome
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION (clustered) — treat components |
| Evidence | AHA/NHLBI statement; component-wise evidence (BP, TG, glucose, waist) |
| Humai | ❌ no row; components partially covered |
| Verdict | **Composite condition — derive from component flags rather than standalone rules** |

### A9. PCOS
| Field | Value |
|---|---|
| Claim class | CONTROL / SYMPTOM improvement; metabolic risk reduction |
| Evidence | **2023 International PCOS Guideline (verified)**: lifestyle intervention for ALL women w/ PCOS (EBR 3.1.1); no single diet superior; weight stigma cautions (PP 3.1.7); benefits without weight loss (3.1.5) |
| Interventions | Multicomponent diet+exercise+behavioral; modest weight loss if higher weight; resistance training |
| Harms | Over-medicalizing; weight-stigma framing |
| Meds | OCP/metformin context — clinician's |
| Monitoring | Waist, lipids, glycemic markers, cycle symptoms (self-report) |
| Humai | ✅ row; ❌ no rules |
| Verdict | **NEEDS_CLINICAL_REVIEW** — strong guideline exists; P2 candidate |

### A10. Gout
| Field | Value |
|---|---|
| Claim class | CONTROL (flare reduction); **diet lowers SU only modestly** — honesty required |
| Evidence | ACR 2020 (verified): treat-to-target ULT SU<6 is the real intervention; diet advice = conditional (↓alcohol, ↓purine, ↓HFCS); weight loss conditional; **vitamin C conditionally AGAINST** |
| Harms | Implying diet alone manages gout; miss ULT indication |
| Meds | Allopurinol (CKD-aware dosing), febuxostat (CV caution) — clinician's |
| Monitoring | Serum urate (lab), flare frequency |
| Humai | ✅ row; rules exist (HIGH_PURINE/HFCS) but attributes unassigned |
| Verdict | **NEEDS_CLINICAL_REVIEW + honest claim framing** — supportive role |

### A11. Hypothyroidism
| Field | Value |
|---|---|
| Claim class | **SUPPORTIVE-ONLY** — levothyroxine is the treatment; lifestyle doesn't treat hypothyroidism |
| Evidence | ATA guidance — consistent levothyroxine timing vs food/calcium/iron (medication-timing safety, not diet therapy); goitrogen warnings mostly outdated for iodine-sufficient populations |
| Harms | Implying diet fixes thyroid; goitrogen fear-mongering (existing rule `GOITROGENIC→warn` is low-value/misleading — flag for clinical review) |
| Meds | Levothyroxine—calcium/iron/coffee timing (pharmacist content) |
| Monitoring | TSH (clinician) |
| Humai | ✅ row; rules exist but evidence-weak |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY + medication-timing warnings** |

### A12. Hyperthyroidism
| Field | Value |
|---|---|
| Claim class | **SUPPORTIVE-ONLY**; excess-iodine caution valid (ATA statement in DB evidence) |
| Harms | High-iodine supplements; stimulant cautions reasonable |
| Humai | ✅ row; CONTAINS_IODINE/CAFFEINE rules exist (no coverage) |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY + supplement cautions** |

---

## GROUP B — Cardiovascular

### B13. Hypertension
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION + CONTROL — BP lowering measurable |
| Evidence | **ACC/AHA 2017 (verified): weight loss, DASH, sodium ↓, potassium ↑ (unless CKD/K⁺-sparing meds), structured exercise, alcohol moderation — all COR I, LOE A** |
| Harms | K⁺ advice dangerous w/ CKD/ACEi/ARB/spironolactone → **medication+CKD interaction rule needed** |
| Monitoring | Home BP readings (device or manual) — **no BP metric today** |
| Humai | ✅ row; HIGH_SODIUM rules exist but 0 sodium data |
| Verdict | **NEEDS_DATA_REMEDIATION (sodium coverage + BP metric)** — P1 |

### B14. Elevated cardiovascular risk
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION — composite ASCVD prevention |
| Evidence | 2019 ACC/AHA Primary Prevention guideline — Life's Essential 8 direction |
| Humai | ❌ no row; derivable from HTN/lipids/diabetes/smoker flag |
| Verdict | **Composite — derive; add risk-factor education** |

### B15. Established CAD
| Field | Value |
|---|---|
| Claim class | CONTROL/RISK-REDUCTION — secondary prevention |
| Evidence | AHA/ACS: cardiac rehabilitation is COR I recommendation; Mediterranean-style diet; smoking cessation |
| Harms | **Unsupervised intensity prescription = unsafe** — requires exercise prescription context (recent event → cardiac rehab referral, not app prescriptions) |
| Monitoring | Clinician-defined; symptoms (angina) = escalation |
| Humai | ❌ no row; activity engine would catch symptoms not diagnosis |
| Verdict | **NEEDS_CLINICAL_REVIEW — education + escalation only; NO autonomous exercise prescription** |

### B16. Peripheral artery disease
| Field | Value |
|---|---|
| Claim class | FUNCTION improvement — supervised walking is first-line |
| Evidence | 2016/2024 AHA/ACC PAD guideline: supervised exercise therapy COR I; walking to near-max claudication tolerance improves distance |
| Harms | Standard activity recs without claudication-aware protocol |
| Humai | ❌ no row; no walking-protocol model |
| Verdict | **NEEDS_CLINICAL_REVIEW** — structured walking possible w/ review |

### B17. Heart failure
| Field | Value |
|---|---|
| Claim class | CONTROL/FUNCTION — exercise-based cardiac rehab recommended (stable HF) |
| Evidence | 2022 AHA/ACC/HFSA HF guideline — exercise training improves functional status (COR 2a); sodium restriction value uncertain (weaker) |
| Harms | Fluid/weight-monitoring failure; exertion w/o clearance; `calorieSafety` already codes HF as clinician-supervised (correct) |
| Monitoring | Daily weight (exists!), symptoms |
| Humai | ✅ row (lowercase "heart failure"); no rules |
| Verdict | **NEEDS_CLINICAL_REVIEW — supervised-only; never autonomous** |

### B18. Post-stroke recovery
| Field | Value |
|---|---|
| Claim class | FUNCTION/RISK-REDUCTION — rehab-driven |
| Evidence | AHA/ASA 2016 stroke rehab & recovery guideline — aerobic+strength+balance after stroke w/ individualized prescription |
| Harms | Generic prescriptions wrong post-stroke (hemiparesis, dysphagia diets, seizure meds) |
| Humai | ❌ no row |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY** — rehab is clinician-directed |

---

## GROUP C — Digestive & liver

### C19. Constipation
| Field | Value |
|---|---|
| Claim class | SYMPTOM improvement — fiber+fluids+activity |
| Evidence | ACG 2021 chronic idiopathic constipation guideline: soluble fiber (psyllium) evidence-based; activity adjunct; red flags require eval |
| Harms | Missing alarm features (blood, weight loss, onset >50) |
| Humai | ❌ no row; fiber engine exists (flagged feature) |
| Verdict | **READY after data remediation** — strong fit w/ fiber engine; P2/P3 |

### C20. GERD
| Field | Value |
|---|---|
| Claim class | SYMPTOM improvement |
| Evidence | ACG 2022 GERD guideline — weight loss if overweight, head-of-bed elevation, avoid late meals; trigger-food advice individualized (NOT universal acid/fat/spice bans — current blanket `ACIDIC/SPICY/HIGH_FAT→warn` over-generalizes) |
| Humai | ✅ row; rules too broad |
| Verdict | **NEEDS_CLINICAL_REVIEW of existing rules** — personalize triggers |

### C21. IBS
| Field | Value |
|---|---|
| Claim class | SYMPTOM improvement |
| Evidence | **ACG 2021 (verified): limited low-FODMAP trial recommended (conditional, very-low-quality evidence) — requires dietitian; NOT long-term elimination; gut-directed psychotherapy; celiac rule-out testing note** |
| Humai | ✅ row; no rules; no FODMAP taxonomy |
| Verdict | **NEEDS_CLINICAL_REVIEW + dietitian referral pathway** — FODMAP is a *trial* not a prescription |

### C22. Functional bloating
| Field | Value |
|---|---|
| Claim class | SYMPTOM — weak specific evidence; overlaps IBS |
| Evidence | Rome IV criteria; ACG bloating guidance — evaluate overlap first |
| Humai | ❌ no row |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY** — fold into IBS pathway |

### C23. Celiac disease
| Field | Value |
|---|---|
| Claim class | CONTROL — strict gluten-free diet is the treatment (not "lifestyle improvement") |
| Evidence | NIDDK celiac (in DB evidence); ACG celiac guideline — lifelong GFD; cross-contact education; **rule-out before GFD adoption** (testing while still eating gluten) |
| Harms | False "gluten-free certified" claims — current `unverifiable` marker on gluten_free is correct; oats attribute needs certification context (F-N4) |
| Humai | ✅ row + rules exist; CONTAINS_GLUTEN coverage 1 ingredient |
| Verdict | **NEEDS_DATA_REMEDIATION + clinical review** — high-harm-if-wrong category |

### C24. Alcohol-related fatty liver
| Field | Value |
|---|---|
| Claim class | CONTROL — **abstinence is the intervention** |
| Evidence | AASLD alcohol-associated liver disease guidance — complete abstinence primary; nutrition support (malnutrition common) |
| Harms | App must not imply diet/exercise substitutes for abstinence; AUDIT screening not in app |
| Humai | ❌ no row; `drinksAlcohol` flag exists on UserHealthProfile |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY + abstinence signposting** |

---

## GROUP D — Musculoskeletal

### D25. Osteoarthritis
| Field | Value |
|---|---|
| Claim class | SYMPTOM + FUNCTION — exercise is first-line non-pharm |
| Evidence | ACR/AF 2019 OA guideline (strong recommendations): exercise (land/aquatic), weight loss if overweight, tai chi; **TOP tier evidence for knee OA** |
| Harms | Rest-avoidance framing; high-impact defaults |
| Humai | ❌ no row; injury/restriction mechanics partially cover |
| Verdict | **NEEDS_ENGINEERING_REMEDIATION — condition key + low-impact plan templates** |

### D26. Chronic nonspecific lower-back pain
| Field | Value |
|---|---|
| Claim class | SYMPTOM/FUNCTION — stay active, exercise, avoid bed rest |
| Evidence | ACP 2017 guideline — non-drug first line: exercise, yoga, tai chi, mindfulness; red-flag triage required |
| Harms | Imaging/rest advice wrong; missing red flags |
| Humai | ❌ no row; injuries model can hold `undiagnosed_pain`/`lower_back` |
| Verdict | **NEEDS_ENGINEERING_REMEDIATION** — activity-first guidance + red-flag screening |

### D27. Sarcopenia
| Field | Value |
|---|---|
| Claim class | FUNCTION — resistance training + protein adequacy is the intervention |
| Evidence | EWGSOP2 consensus; ESPEN protein guidance (1.0–1.2 g/kg older adults, illness context higher); progressive resistance evidence |
| Harms | Protein targets unsafe in CKD → cross-condition rule needed |
| Humai | ❌ no row; resistance library strong |
| Verdict | **NEEDS_CLINICAL_REVIEW (protein×CKD interaction) — P3** |

### D28. Osteopenia | D29. Osteoporosis
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION + FUNCTION; bone density modestly improvable; **fracture prevention is the real target** |
| Evidence | NOF/BoneSource (verified): weight-bearing + muscle-strengthening lifelong; **caution: spinal flexion/twisting + high-impact unsafe in established osteoporosis/fragility**; Ca+vitD adequacy (1000–1200mg / 800–1000IU typical guidance); clinician eval before vigorous programs |
| Harms | Crunches/sit-ups/twisting in osteoporosis = fracture risk — **needs exercise-class restrictions** |
| Monitoring | DXA (clinical), falls, height loss |
| Humai | ❌ neither row exists; activity engine can encode flexion restrictions |
| Verdict | **Osteopenia: NEEDS_DATA_REMEDIATION · Osteoporosis: NEEDS_CLINICAL_REVIEW (exercise restrictions mandatory)** |

### D30. Postural dysfunction / deconditioning
| Field | Value |
|---|---|
| Claim class | FUNCTION — progressive activity is appropriate |
| Evidence | ACSM general exercise principles; low clinical risk |
| Humai | ❌ no row; `fitnessExperience=beginner` + suitability adapt path exist |
| Verdict | **READY after engineering** — lowest-risk condition, good pilot candidate |

---

## GROUP E — Sleep, mental health & respiratory

### E31. Obstructive sleep apnea
| Field | Value |
|---|---|
| Claim class | CONTROL — weight loss improves AHI; **does NOT replace CPAP/PAP** |
| Evidence | AASM params (verified): dietary weight loss improves AHI (Guideline) — combined w/ primary treatment; 10–20% weight change → retest; AASM surgical referral at BMI≥35 if PAP-intolerant |
| Harms | Implying weight loss is sufficient; missing sleepiness-safety issues |
| Monitoring | Weight, (PSG/HSAT by clinician), daytime sleepiness self-report |
| Humai | ❌ no row; weight program exists |
| Verdict | **NEEDS_CLINICAL_REVIEW — adjunctive weight support only** |

### E32. Insomnia
| Field | Value |
|---|---|
| Claim class | SYMPTOM/FUNCTION — CBT-I is first-line STRONG recommendation |
| Evidence | **AASM 2021 (verified): multicomponent CBT-I STRONG**; sleep hygiene alone insufficient |
| Humai | ❌ no row; SleepLog + reminders could support CBT-I-adjacent behaviors but app is not a CBT-I program |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY** — sleep-hygiene support + referral for CBT-I; ISI tracking possible |

### E33. Depression
| Field | Value |
|---|---|
| Claim class | SYMPTOM adjunct — **exercise has moderate evidence as adjunct treatment** |
| Evidence | **BMJ 2024 network meta-analysis (verified): walking/jogging g≈−0.62, yoga −0.55, strength −0.49 vs active controls — moderate real effect**; never a replacement for care |
| Harms | Crisis signals must escalate; no mood tracking today |
| Monitoring | PHQ-9 (validated instrument — MISSING) |
| Humai | ❌ no row; MindHome/wellness check-ins exist |
| Verdict | **NEEDS_CLINICAL_REVIEW + crisis escalation path + PHQ-9** — exercise adjunct only |

### E34. Anxiety disorders
| Field | Value |
|---|---|
| Claim class | SYMPTOM adjunct |
| Evidence | Exercise meta-analyses show small-moderate anxiolytic effects; mindfulness/mind exercises reasonable |
| Monitoring | GAD-7 (MISSING) |
| Humai | ❌ no row; MindTrack exists |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY + referral pathways** |

### E35. Chronic stress
| Field | Value |
|---|---|
| Claim class | SYMPTOM |
| Evidence | Mindfulness/activity evidence moderate; avoid medicalizing |
| Humai | ❌ no row; mind feature exists |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY** |

### E36. Asthma
| Field | Value |
|---|---|
| Claim class | CONTROL/FUNCTION — exercise improves fitness; **does not treat asthma** |
| Evidence | GINA strategy — exercise beneficial; EIB management: pre-exercise bronchodilator is medical; trigger awareness (cold air/pollen/AQI) legit |
| Harms | High-intensity outdoor in poor AQI without planning; exercise-induced bronchoconstriction ignored |
| Humai | ❌ no row; environmental hazard dimension exists in activity engine! |
| Verdict | **NEEDS_ENGINEERING_REMEDIATION — env-trigger awareness + warmup guidance** |

---

## GROUP F — Kidney & reproductive

### F37. Chronic kidney disease
| Field | Value |
|---|---|
| Claim class | CONTROL/RISK-REDUCTION — diet slows progression |
| Evidence | **KDIGO 2024 (verified): protein 0.8 g/kg/d G3–G5, avoid >1.3; sodium <2g/d; plant-forward; renal dietitian referral; stage-tallored K⁺/PO₄; older/frail → higher protein targets (counter-sarcopenia tension!)** |
| Harms | **Generic muscle-gain protein targets (2.0–2.2 g/kg in code!) are UNSAFE for CKD** — cross-rule required; K⁺ advice needs stage context |
| Monitoring | eGFR, BP, (labs missing) |
| Humai | ✅ row; K⁺/PO₄ rules exist w/ 0 coverage; `ckd` already in calorieSafety supervised set |
| Verdict | **NEEDS_CLINICAL_REVIEW + stage model + protein-target override** — never unsupervised protein prescriptions |

### F38. Kidney stones
| Field | Value |
|---|---|
| Claim class | PREVENTION of recurrence — strong evidence for fluid |
| Evidence | **AUA (verified): urine volume ≥2.5L/d (fluid intake to achieve it); normal dietary calcium (restriction INCREASES risk); limit sodium + animal protein; stone-type-specific advice** |
| Harms | Generic "low-oxalate" lists misapplied; calcium restriction = harmful |
| Humai | ❌ no row; WaterLog + reminders support fluid goal |
| Verdict | **NEEDS_DATA_REMEDIATION (stone type, oxalate data) — hydration coaching is safe now** |

### F39. Gestational diabetes
| Field | Value |
|---|---|
| Claim class | CONTROL during pregnancy; PREVENTION of T2D after |
| Evidence | **ACOG (verified): diet+exercise control glucose for most; 150min/wk; post-meal 10–15min walks improve control; medication when needed; postpartum diabetes screening** |
| Harms | Any calorie deficit during pregnancy; uncontrolled glucose; `calorieSafety` pregnancy→review correct |
| Monitoring | Glucose (patient meter), fetal surveillance (clinical) |
| Humai | ❌ GDM absent (Pregnancy row exists, not user-settable) |
| Verdict | **NEEDS_CLINICAL_REVIEW — supervised-pathway only; pregnancy status is opt-in today** |

### F40. Fertility problems w/ metabolic dysfunction
| Field | Value |
|---|---|
| Claim class | RISK-REDUCTION — weight/metabolic optimization supports fertility |
| Evidence | PCOS guideline (ovulatory function improves w/ weight management); ASRM/ESHRE lifestyle guidance |
| Harms | Implying diet guarantees conception; complex infertility needs specialist care |
| Humai | ❌ no row |
| Verdict | **SUPPORTIVE_EDUCATION_ONLY + specialist referral** |

---

## Summary readiness tally

| Verdict | Count | Conditions |
|---|---|---|
| READY_FOR_IMPLEMENTATION (after standard gates) | 4 | Obesity(A5), Prediabetes(A3), Insulin resistance(A2), Postural dysfunction(D30) |
| NEEDS_DATA_REMEDIATION | 6 | MASLD, High LDL, Constipation, Kidney stones, Celiac(24), Metabolic syndrome(A8 derive) |
| NEEDS_ENGINEERING_REMEDIATION | 5 | HTN(BP metric), OA, Low-back pain, Asthma, + T2D rule-authoring |
| NEEDS_CLINICAL_REVIEW | 13 | T2D, HTG, PCOS, Gout, CKD, GDM, Osteoporosis, Sarcopenia, OSA, Depression, GERD rules, IBS, Celiac |
| NEEDS_REGULATORY_REVIEW | subset | any remission framing (T2D), lab interpretation |
| SUPPORTIVE_EDUCATION_ONLY | 9 | Hypo/Hyperthyroid, CAD, Post-stroke, HF*, Alcoholic liver, Insomnia, Anxiety, Chronic stress, Bloating, Fertility |
| BLOCKED | 0 | none — but all need condition write path |

*HF could argue supervised-only rather than education-only; conservative call pending clinical input.
