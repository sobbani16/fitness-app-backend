# Medical Rule Evidence — Status and Approval Path

**Purpose:** the safety-critical difference between *implemented* and *enabled*
clinical rules. Constraint mechanisms exist; enforcement of each rule is
gated on `reviewStatus = APPROVED`. DRAFT rules are inert by design.
**Current live count: 0 APPROVED / 48 total (updated 2026-11-21).**

## Rule inventory (all DRAFT)

### A. ConditionRule — legacy tier (31 rules, no `RuleEvidence` row)

These carry a free-text `reason` only. **Not approvable** until an evidence
source is attached — the endpoint blocks on `no_evidence_source`.

| Condition | Attribute | Action | Target | Blocking gaps |
|---|---|---|---|---|
| Type 2 Diabetes | HIGH_SUGAR | block | ingredient + supplement | no evidence |
| Type 2 Diabetes | HIGH_GLYCEMIC | warn | ingredient | no evidence |
| Type 2 Diabetes | DIABETES_CAUTION | warn | supplement | no evidence |
| Type 1 Diabetes | HIGH_SUGAR | block | ingredient | no evidence |
| Type 1 Diabetes | HIGH_GLYCEMIC | warn | ingredient | no evidence |
| Hypothyroidism | GOITROGENIC | warn | ingredient | no evidence; goitrogen risk is dose/preparation-dependent — needs applicability criteria |
| Hypothyroidism | THYROID_CAUTION | warn | supplement | no evidence |
| Hyperthyroidism | CONTAINS_IODINE | warn | ingredient | no evidence; iodine content data coverage unknown |
| Hyperthyroidism | CONTAINS_CAFFEINE | warn | supplement | no evidence |
| CKD | HIGH_POTASSIUM | block | ingredient + supplement | no evidence; CKD staging determines whether blanket block is appropriate — `requiresPersonalization` |
| CKD | HIGH_PHOSPHORUS | block | ingredient | no evidence; staging-dependent |
| CKD | HIGH_SODIUM | warn | ingredient | no evidence |
| Hypertension | HIGH_SODIUM | block | ingredient + supplement | no evidence; "HIGH_SODIUM" attribute definition needed (mg threshold) |
| Hypertension | CONTAINS_CAFFEINE | warn | supplement | no evidence |
| GERD | ACIDIC / SPICY / HIGH_FAT | warn | ingredient | no evidence; trigger foods are patient-variable — keep warn, never block |
| Celiac Disease | CONTAINS_GLUTEN | block | ingredient + supplement | no evidence; straightforward but needs attribute coverage audit on catalog |
| Nut/Shellfish/Dairy/Egg/Soy Allergy | NUT/SHELLFISH/DAIRY/EGG/SOY | block | ingredient | no evidence; redundant with UserAllergy path — verify not double-blocked |
| Gout | HIGH_PURINE | warn | ingredient | no evidence; purine content data coverage unknown |
| Pregnancy | PREGNANCY_CAUTION | block | supplement | no evidence; scope too broad — needs per-item applicability |
| Pregnancy | CONTAINS_CAFFEINE | warn | supplement | no evidence; 200mg/day limit is ACOG-aligned but unattributed |
| Pregnancy | HIGH_MERCURY | block | ingredient | no evidence; mercury species list needs definition |

### B. ConditionRule — clinical tier (3 rules, evidence attached)

| Condition | Attribute | Action | Evidence | Pub. year | Blocking gaps |
|---|---|---|---|---|---|
| Celiac Disease | CONTAINS_GLUTEN | clinical | NIH/NIDDK "Eating, Diet, & Nutrition for Celiac Disease" | not recorded | year missing from RuleEvidence |
| Lactose Intolerance | CONTAINS_LACTOSE | clinical | NIH/NIDDK "Eating, Diet, & Nutrition for Lactose Intolerance" | not recorded | tolerance is dose-variable — personalization criteria |
| Gout | CONTAINS_HIGH_FRUCTOSE_CORN_SYRUP | clinical | American College of Rheumatology 2020 gout guideline | 2020 | conditional recommendation — document strength |

### C. HealthConditionNutrientRule (14 rules, evidence attached, thresholds missing)

**Every rule has `thresholdValue = null`** — a LIMIT rule without a threshold
cannot fire even if approved. `limit_without_threshold` blocks approval.
Publication years are unpopulated on all evidence records.

| Code | Condition | Nutrient | Action | Personalization | Evidence org |
|---|---|---|---|---|---|
| DIABETES_0_ADDED_SUGAR | T1D | Added Sugar | LIMIT | no | ADA |
| DIABETES_0_CARBS | T1D | Total Carb | MONITOR | no | NIH/NIDDK |
| DIABETES_1_ADDED_SUGAR | T2D | Added Sugar | LIMIT | no | ADA |
| DIABETES_1_CARBS | T2D | Total Carb | MONITOR | no | NIH/NIDDK |
| DIABETES_2_ADDED_SUGAR | Prediabetes | Added Sugar | LIMIT | no | ADA |
| HYPERTENSION_SODIUM | HTN | Sodium | LIMIT | no | AHA — highest approval-readiness; needs mg/serving threshold |
| CKD_POTASSIUM | CKD | Potassium | LIMIT | **yes** — staging-dependent | NIH/NIDDK |
| CKD_PHOSPHORUS | CKD | Phosphorus | LIMIT | **yes** | NIH/NIDDK |
| LDL_SATURATED_FAT | High LDL | Saturated Fat | LIMIT | no | AHA |
| TRIGLYCERIDES_SUGAR_ADDED | Hypertriglyceridemia | Added Sugar | LIMIT | no | AHA/ACC |
| TRIGLYCERIDES_FAT_SATURATED | Hypertriglyceridemia | Saturated Fat | LIMIT | no | AHA/ACC |
| IRON_DEFICIENCY_DIET | Iron Deficiency | Iron | PRIORITIZE | no | NIH ODS — non-blocking action; no threshold needed to fire |
| THYROID_0_IODINE_REVIEW | Hypothyroidism | Iodine | MONITOR | yes | ATA |
| THYROID_1_IODINE_REVIEW | Hyperthyroidism | Iodine | MONITOR | yes | ATA |

## Technical approval workflow (implemented)

- `GET /admin/clinical-rules` — full review queue with per-rule `gaps`
  (`no_evidence_source`, `limit_without_threshold`). Gate: `VIEW_PLATFORM_ANALYTICS`.
- `POST /admin/clinical-rules/transition` — `{type, id, to, attestation}`.
  Gate: `ACADEMY_CLINICAL_REVIEW`. `APPROVED` additionally requires
  ≥20-char attestation and **zero gaps**. Writes `reviewedBy` (caller),
  `reviewedAt`, increments `version`, and records a `SafetyAuditLog`
  `clinical_rule_review` entry.

## What still cannot be approved and why

- **0/31 legacy ConditionRules** — no `RuleEvidence` row. A clinician must
  attach evidence (org, guideline, year, URL) before review.
- **14/14 nutrient rules** — no thresholds and no evidence publication years.
  Thresholds are a clinical decision (e.g., AHA <2300mg sodium/day, ideal
  1500mg — but per-serving vs daily basis must be set by the reviewer).
- **3/3 clinical ConditionRules** — closest to ready; still need publication
  years + reviewer attestation.

## Contraindication & patient-information notes for reviewers

- `requiresPersonalization` rules (CKD, thyroid) must not be approved as
  blanket blocks — staging/labs determine applicability.
- Warn-tier rules (GERD, gout) stay warnings; upgrading to block needs
  explicit reviewer justification.
- Allergy ConditionRules duplicate the `UserAllergy` path — confirm they add
  coverage (compound-ingredient attributes) rather than double-blocking.
- Rules never auto-fire post-approval without `loadConstraints` reading them
  — the mechanism honors `reviewStatus` at query time, so approval takes
  effect on next request (no deploy needed; cache-invalidation noted in
  architecture.md).

## Reviewer requirements

Credential attestation recorded per transition; reviewer should be an RD/MD
with condition-relevant scope. Attestation must cite the evidence actually
reviewed — "generally accepted" is not a basis.

## Test coverage

- Mechanism tests exist (`recipeValidate`/`recipeConstraints`) proving
  APPROVED rules fire and DRAFT rules are inert.
- Endpoint tests for the transition route are pending (TODO: mock prisma
  + permission middleware; assert 422 on gaps, 403 without permission).
