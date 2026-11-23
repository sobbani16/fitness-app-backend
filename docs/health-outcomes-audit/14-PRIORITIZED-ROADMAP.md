# 14 — Prioritized Implementation Roadmap

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
Ordering logic: safety holes first, then foundation inputs (nothing else works without them), then P1 metabolic (evidence strongest + data closest), then expanding complexity.

## P0 — Foundation & safety remediation (prerequisite for everything)

| # | Deliverable | Depends | Effort | Release gate |
|---|---|---|---|---|
| P0.1 | `PUT/GET/DELETE /me/health-conditions` + registry + consent + mobile screen + `healthConditions` flag | schema ext | M | write/read round-trip + audit log + plan revalidation |
| P0.2 | `Medication`+`UserMedication` models + API + `medicationActivityFlags` sync | — | M | hypoglycemia flag path verified e2e |
| P0.3 | `ClinicalMeasurement` model + `/me/clinical-measurements` API (validated units, provenance) | — | M | unit registry + contradiction handling tests |
| P0.4 | Micronutrient backfill: USDA FDC profiles for all catalog ingredients | data QA pipeline exists (nutrients:import) | M | ≥90% catalog coverage; verifiedAt provenance |
| P0.5 | Fix `mealRecommendationService` conditions gap + re-seed SYSTEM recipe nutrition | — | S | recomputation matches stored; tests |
| P0.6 | Wire `calorieSafety` floor into target calc behind flag + clinical sign-off | clinical review | S | floor enforcement test suite |
| P0.7 | Rule-evidence hygiene: remove test fixtures from RuleEvidence/Ingredient; `synthetic` flag | — | S | fixture-exclusion test |
| P0.8 | `UserClinicalReview` escalation queue (patient-level) | — | M | symptom→review→clinician artifact |

## P1 — Metabolic health (highest-evidence, largest population)

| # | Deliverable | Depends | Clinical review | Effort |
|---|---|---|---|---|
| P1.1 | Obesity + Prediabetes + Insulin resistance journeys: condition rules (APPROVED) + weight/waist tracking + DPP-style targets | P0 | Rules + claims review | M |
| P1.2 | Hypertension: sodium data on recipes + DASH pattern rules + **BP measurement ingest** + K⁺-interaction safety (CKD/meds) | P0.3/P0.4 | Yes — K⁺ advice boundaries | M |
| P1.3 | MASLD: Mediterranean-pattern rules + weight-loss pacing + alcohol-fructose guidance + FIB-4 signposting | P0 | Yes | M |
| P1.4 | High triglycerides + High LDL: sat-fat/added-sugar recipe scoring + refined-carb rules | P0.4 | Yes | M |
| P1.5 | Metabolic syndrome composite derivation (no standalone rules) | P1.1–P1.4 | Yes | S |
| P1.6 | Aerobic-exercise catalog expansion (walking/cycling/swim/elliptical + intensity bands) | — | exercise review | S–M |

**P1 exit criteria:** 5 conditions live for real users with APPROVED rules, measurements tracked, explainability payload on every recommendation, all behind `health_outcomes` flag + allowlist pilot.

## P2 — Expanded metabolic + lifestyle

| # | Deliverable | Notes |
|---|---|---|
| P2.1 | T2D (diet-controlled only): carb-quality rules + post-meal activity + A1c tracking. **Insulin/SU users stay education-only until medication-context safety ships** | Needs medication model + hypoglycemia e2e |
| P2.2 | PCOS: guideline-based lifestyle rules + stigma-safe copy | 2023 guideline sourced |
| P2.3 | OA + low-back pain: low-impact templates + activity-first guidance + red-flag screening | exercise review |
| P2.4 | Constipation + GERD: fiber/fluid paths + individualized trigger tracking | reuse fiber engine |
| P2.5 | Insomnia/stress/mild-anxiety: sleep-hygiene support + validated questionnaires (ISI/PHQ-9/GAD-7) + referral signposting | crisis-escalation review required |
| P2.6 | Celiac: GF enforcement upgrade (certification-aware, cross-contact education) | high-harm category — clinical review mandatory |

## P3 — Higher complexity (clinician-linked)

| # | Deliverable | Notes |
|---|---|---|
| P3.1 | CKD stages G3–G5: protein-target override (0.8g/kg) + K⁺/PO₄/Na stage rules + sarcopenia tension rule | kidney-dietitian content; NO protein prescriptions w/o stage |
| P3.2 | Kidney stones: hydration coaching + stone-type dietary rules | needs stone-type field |
| P3.3 | GDM: pregnancy pathway + post-meal walks + glucose tracking + postpartum transition | ACOG-derived; supervised |
| P3.4 | Osteoporosis/osteopenia: weight-bearing emphasis + flexion/twist restriction rules + Ca/vitD adequacy | exercise restriction classes |
| P3.5 | Sarcopenia: resistance progression + protein adequacy (CKD-aware) | protein×CKD interaction |
| P3.6 | OSA adjunct: weight program + sleep signposting (never CPAP replacement) | claim boundaries |
| P3.7 | Depression/anxiety adjunct: exercise prescription w/ PHQ-9/GAD-7 + crisis escalation | clinical review mandatory |

## Not in scope for automated plans (education-only / supportive)

Hypothyroidism (levothyroxine-timing support only), Hyperthyroidism, established CAD, post-stroke, heart failure, alcoholic liver disease, functional bloating (fold into IBS), fertility, asthma (env-trigger awareness only — engineering-light variant possible P2).

## Rollback strategy per phase

Each release ships behind flags w/ `rollback = flag off` (additive tables only). Clinical rule changes are versioned (`version` col exists) — rollback = deactivate rule version, never delete.

## Founder decisions required (see doc 16 §19)

1. Approve condition write-path + consent model scope.
2. Approve medication modeling (self-reported only vs. interaction-checking depth).
3. Approve lab-value collection (storage liability vs. outcome-measurement value).
4. Approve clinical-review resourcing (rule approvals are the real throughput limiter).
5. Approve "education-only" framing for cardiac/thyroid/ALD conditions (product scope).
6. Approve language policy: "supports management of X" wording vs stronger claims (regulatory gate).
