# 16 — Final Executive Report

**Audit:** HEALTH-OUTCOMES-AUDIT-2026-11-22 · **Date:** 2026-11-22
**Repos:** backend `b75044a` · mobile `5cc1831` · dev DB `fitness_app` (read-only)

## Executive summary metrics

| Metric | Result |
|---|---|
| Conditions audited | **40 / 40** |
| Clinical evidence checks | **18 verified live / 35 reviewed** (17-EVIDENCE-SOURCE-REGISTER) |
| Source-code modules audited | ~35 files read end-to-end + all 204 Prisma models inventoried + prior audit docs (75+) reviewed |
| Database tables inspected | ~30 directly queried; all ~204 inventoried (pg_stat) |
| Ingredient records assessed | 426 |
| Recipe records assessed | 258 |
| Exercise records assessed | 884 |
| **Critical findings** | **4** (F-C1 condition write path missing · F-C2 zero approved rules · F-C3 no medication model · F-C4 no lab ingest) |
| **High findings** | **7** (micronutrient 4.2% coverage · stale SYSTEM recipes · attribute misclassifications · meal-rec conditions gap · cardio 1.6% · all activity rules DRAFT · deletion coverage risk) |
| Medium findings | 12 |
| Existing tests executed | Backend 5,957 + Mobile 673 + mobile typecheck |
| Tests passing | **6,630 pass / 6,634 run** (4 skipped) |
| Tests failing | **0** |
| Blocked checks | Production-DB certification (dev-only access) |
| Conditions ready for implementation | **4** (obesity, prediabetes, insulin resistance, postural dysfunction — pending standard gates) |
| Conditions needing clinical review | 13 |
| Conditions education/supportive-only | 9 |
| Conditions needing data remediation | 6 |
| Conditions needing engineering remediation | 5 |

## The 20 questions

1. **What can Humai already do correctly?** Food logging w/ explicit nutrient-unknown tracking; per-100g meal math; BMR/TDEE/targets w/ goal history; allergen filtering (canonical, narrowing-only, revalidating plans); supplement catalog+dose tracking; symptom/injury/restriction-driven activity safety (always-on mechanics); pose coaching w/ honest uncertainty states; wearable sync; account deletion/export; feature-flag governance; AI-with-deterministic-validation patterns.
2. **Partial capabilities?** Condition rules (correct code, zero approved data); activity safety (mechanics work, medical rule layer inert); recipe intelligence (validation works, condition-awareness absent); weekly plans (work, no condition personalization); clinical governance (machinery exists, never exercised).
3. **Inaccessible to real users?** Everything condition-aware: users cannot record health conditions (no API/UI). Supplement interaction rules (0 approved). Any lab-driven personalization.
4. **Incorrect nutrition calculations?** 15/28 SYSTEM recipes >20% off stored-vs-computed (stale seeds); mealNutrition math itself is correct.
5. **Unreliable ingredient values?** salmon=HIGH_MERCURY (wrong), oats=CONTAINS_GLUTEN (context), banana/sweet-potato HIGH_GLYCEMIC blanket; 9 "BREAD" test fixtures in catalog; 23 dup names; 96% lack sodium/K⁺/PO₄/sugar/sat-fat values.
6. **Unsafe recipe recommendations?** Currently none generated for conditions (inert) — risk is **unsafe-by-omission**: T2D+CKD user gets normal recipes silently; SYSTEM recipes show wrong kcal; `generateFoodSuggestions` drops `conditions` entirely.
7. **Unsafe exercise recommendations?** No wrong prescriptions found — engine is conservative; risk = absence of cardiac/osteoporosis/CKD condition paths (a CAD user is treated as healthy) + near-zero cardio options.
8. **Clinical claims lacking evidence?** `GOITROGENIC→warn` for hypothyroidism is outdated-evidence-weak; blanket HIGH_SUGAR block for T2D contradicts ADA (context-dependent carbs); GERD blanket trigger warnings vs ACG individualized approach; salmon mercury mislabel would produce wrong pregnancy advice.
9. **Missing condition-specific recommendations?** Effectively all 40 — personalization layer is 0% active (consistent with repo's own gap analysis).
10. **Conflicting multi-condition combos?** None generated today (nothing fires). Latent conflicts documented: CKD×sarcopenia (protein), HTN×CKD (K⁺), osteoporosis×CKD (Ca/PO₄), T2D×insulin (fueling vs targets), pregnancy×GDM (deficit ban).
11. **Trackable measurements?** Weight, steps, water, sleep, active/resting energy, workouts, food logs, habits, fiber, streaks.
12. **Reliably measurable outcomes?** Behavior adherence + weight only. No labs, no BP, no waist, no validated instruments → clinical outcomes unverifiable today.
13. **Privacy/security gaps?** New-PHI-table deletion coverage (F-S2); test fixtures in evidence/catalog tables; voice auto-writes medical-adjacent records; prod CORS/encryption unverifiable from repo.
14. **Regulatory questions for experts?** Non-device CDS boundary if lab interpretation or condition-management claims ship; MHMD/DPDP consent for new health data; FTC truth-in-claims for any outcome marketing; trainer=PHI-processor analysis; app-store medical-app review.
15. **First 5 conditions to prioritize?** Obesity, prediabetes (+insulin resistance), hypertension, MASLD, dyslipidemia (LDL+TG) — highest evidence + largest population + cheapest data lift (weight/BP/A1c vs imaging).
16. **Fix before new features?** Condition write path (F-C1); approved-rule pipeline (F-C2); SYSTEM recipe nutrition (F-N3); meal-rec conditions gap (F-R1); fixture hygiene (F-N5); deletion coverage (F-S2); calorie floor wiring (proposal exists).
17. **Architecture changes necessary?** Medication + ClinicalMeasurement + condition-registry models; precedence resolver service; recipe nutrient roll-up; patient-level clinical-review queue; consumer outcome journey; all reusing existing governance machinery (doc 13).
18. **Estimated effort?** P0 ≈ 6–9 eng-weeks + clinical review time; P1 ≈ 10–14 wks; P2 ≈ 10–14 wks; P3 ≈ 12+ wks (clinical review is the throughput limiter, not engineering).
19. **Founder approvals needed?** Medication collection scope; lab-value storage liability; education-only scope for cardiac/thyroid/ALD; clinical reviewer resourcing; claims language ceiling; pilot cohort criteria.
20. **Evidence for roadmap?** Doc 03 matrix — ordered by evidence strength (DPP/AGA/DiRECT/KDIGO/ACR/ACG/AASM/ACOG verified) × data-readiness × safety risk × regulatory exposure.

## Verdict

Humai's **safety architecture is genuinely well-built** — governance, provenance, uncertainty handling, and conservative defaults are ahead of typical consumer-health apps. The product today is a strong **behavior-tracking + allergy-safe food platform** with an inert clinical layer.

It is **not yet a health-outcomes platform**: users can't record conditions, no rules are approved, no medications or labs are modeled, and only ~4% of food has the nutrients those rules need. The honest path is P0 foundation first — the machinery to be safe exists; the inputs to be useful do not.

---

**Status: AUDIT COMPLETE (dev-scope) — awaiting founder review. No production changes or new health-outcomes features were implemented.**
