# EVIDENCE_REGISTER — sources the implementation currently relies on

Status legend: **VERIFIED-TEXT** = URL present in repo and content matches how it's used · **CITED-UNVERIFIED** = real-looking citation, content not re-verified this session · **STALE-CHECK** = needs periodic re-review · **LICENSED-GATE** = blocked pending license/rights.

## A. Guideline/rule evidence (data/condition-rules/initial.js — 12 records, all DRAFT, lastReviewedAt 2026-10-27)

| Code | Publisher | Title | Use | Status |
|---|---|---|---|---|
| AHA_SATURATED | American Heart Association | Saturated Fats | LDL sat-fat LIMIT rule | CITED-UNVERIFIED (URL present) |
| AHA_DYSLIPIDEMIA_2026 | AHA/ACC | 2026 Guideline on the Management of Dyslipidemia | Triglycerides LIMIT ×2 | CITED-UNVERIFIED |
| NIH_IRON | NIH ODS | Iron — Health Professional Fact Sheet | Iron-deficiency PRIORITIZE | CITED-UNVERIFIED |
| ATA_IODINE | American Thyroid Association | Excess iodine risks statement | Thyroid iodine MONITOR ×2 (CLINICIAN scope) | CITED-UNVERIFIED |
| ACR_GOUT_2020 | American College of Rheumatology | 2020 gout guideline (PMC10563586) | HFCS LIMIT (conditional rec — encoded as LIMIT, conditional) | CITED-UNVERIFIED |
| PCOS_GUIDELINE | Monash + intl partners | International evidence-based PCOS guideline | Deliberately encodes NO universal restriction | CITED-UNVERIFIED |
| ADA_EATING | American Diabetes Association | Tips for Eating Well | Diabetes added-sugar LIMIT ×3 | CITED-UNVERIFIED |
| NIDDK_DIABETES | NIH/NIDDK | Healthy Living with Diabetes | Diabetes carb MONITOR ×2 | CITED-UNVERIFIED |
| AHA_SODIUM | AHA | Shaking the Salt Habit | Hypertension sodium LIMIT | CITED-UNVERIFIED |
| NIDDK_CKD | NIH/NIDDK | Healthy Eating for Adults with CKD | CKD K/Phos LIMIT (LAB_DEPENDENT + personalization) | CITED-UNVERIFIED |
| NIDDK_CELIAC | NIH/NIDDK | Celiac eating/diet/nutrition | Gluten AVOID_IF_INDICATED (HIGH) | CITED-UNVERIFIED |
| NIDDK_LACTOSE | NIH/NIDDK | Lactose intolerance nutrition | Lactose MONITOR (personalization) | CITED-UNVERIFIED |

Note: `publicationYear` intentionally null where not established — no fabricated dates. All rules `reviewStatus=DRAFT`, inert until clinical reviewer approves. **None of these rows exist in the local DB** (import never run).

## B. Nutrient reference values (src/services/nutrientCatalog.js — 52 keys)

| Basis | Used for | Status |
|---|---|---|
| FDA_DV (21 CFR 101.9) | protein 50, carbs 275, fat 78, fiber 28, addedSugar 50, satFat 20, cholesterol 300, sodium 2300, potassium 4700, Ca 1300, Fe 18, Mg 420, P 1250, Zn 11, Se 55, I 150, Cu 0.9, Mn 2.3, Cr 35, Mo 45, Cl 2300, vitA 900, C 90, D 20, E 15, K 120, B1 1.2, B2 1.3, B3 16, B5 5, B6 1.7, biotin 30, folate 400, B12 2.4, choline 550 | CITED-UNVERIFIED — labeled `basis:'FDA_DV'`; values match published DVs on spot-check |
| NIH_AI_male | ALA 1.6 g | CITED-UNVERIFIED |
| IOM/NASEM ULs | upperLimit fields (Ca 2500, Fe 45, P 4000, Zn 40, Se 400, I 1100, Cu 10, Mn 11, Mo 2000, A 3000, C 2000, D 100, E 1000, B3 35, B6 100, folate 1000) | CITED-UNVERIFIED |
| "no-established-target" | sugar, trans fat, MUFA/PUFA, omega3/6, EPA/DHA, soluble/insoluble fiber, caffeine | Compliant — explicitly no invented reference |

## C. Food composition provenance

| Source | License | Where | Status |
|---|---|---|---|
| USDA FoodData Central (SR Legacy Apr 2018, Foundation Apr 2026, FNDDS) | CC0 — `license:'CC0-1.0'` recorded per profile | `data/nutrient-sources/usda/*.json` (162 files, retrieved 2026-10-27) + live `api.nal.usda.gov/fdc/v1` | VERIFIED-TEXT (README + per-file envelopes); endpoint/dataType/publicationDate/retrieval validated in `fromUsda()` |
| ICMR-NIN IFCT | **Not licensed for use** | `fromReviewed()` refuses unlicensed imports | LICENSED-GATE — no IFCT rows exist; requires founder to obtain rights + reviewed export |
| Open Food Facts | ODbL | `foodIntel.fetchOpenFoodFacts` — flag-gated `food_external_catalog_enabled`, `dataQuality:'community'` | Compliant — never marked verified |
| Spoonacular | commercial key present in .env | — | Usage sites not audited this session — UNVERIFIED scope |

## D. Ingredient education claims (foodIntel.js EVIDENCE_SEED — 10 profiles, seeded APPROVED by 'humai-editorial')

Cinnamon, turmeric, ginger, oats, garlic, fenugreek, flaxseed, chia, yogurt, fiber. Each claim carries verdict (established|mixed|insufficient|marketing), applicability, studyType, dose, limitations, source string. Source strings are descriptive ("Cochrane-style reviews", "FDA/EFSA-authorized claim", "ISAPP consensus") — **not URL-pinned** → mark CITED-UNVERIFIED; hardening = attach RuleEvidence-style records or source URLs per claim. FDA-authorized beta-glucan→LDL claim is real (21 CFR 101.81) but the register should cite it.

## E. Scoring/energy formulas in use

| Formula | Where | Evidence basis | Status |
|---|---|---|---|
| Mifflin-St Jeor BMR | calorieEngine.js:51 | Standard reference (validation report §B) | Accepted |
| Activity factors 1.2–1.9 | calorieEngine.js:8 | Standard multipliers | Accepted |
| Goal deltas −500/+400/+500/0 | calorieEngine.js:23 | Common practice; not clinical prescription | Accepted as product policy, not evidence claim |
| Fiber 14 g/1000 kcal | validation report endorses; catalog FDA_DV 28 g | IOM | Accepted |
| dps-v2 caps 40/20/20/15/5 | scoringV2.js:6 | **Product design, not clinical** — labeled as adherence estimate | Needs D5 labeling decision |
| Sleep ≥7h adequate | scoringV2.js:101 | AASM adult duration | Accepted |
| WHO 150 min/wk movement | scoringV2.js:87 | WHO activity guideline | CITED-UNVERIFIED (no citation in code) |
| FDA DV refs as moderation limits (sugar 50/satfat 20/sodium 2300) | scoringV2.js:74-76 | FDA label DVs | Accepted as display references, not personalized limits |

## F. Claims the codebase correctly refuses to make (verified by absence)

- No insulin-spike/seed-oil/gluten/dairy "inflammatory" rules · no fat-burning-food, blood-type, or microbiome-avoidance claims · no universal 20–25% nut calorie adjustment · no fixed recipe undercount percentage · no blanket sodium restriction for all users · barcode scans never marked verified · supplement doses never merged into food nutrient totals.
