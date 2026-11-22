# US_INDIA_REGULATORY_REVIEW — feature-by-feature classification inputs

**Purpose:** assemble the facts external counsel/regulatory reviewers need. **No legal conclusions.** Each row: intended use → claim → population → output → potential harm → questions for counsel.

| # | Feature | Intended use | Claim made to user | Population | Output | Potential harm | Regulatory questions |
|---|---|---|---|---|---|---|---|
| 1 | Daily Progress Score v2 (`dps-v2.1`) | adherence estimate | "adherence to your logged targets — not a health measurement" | adults 18+ | 0–100 score + component states | low; misreading as health metric (mitigated by `state` + note) | does "score" framing itself imply a health claim in marketing copy? |
| 2 | MacroGoal-derived targets | goal pacing | calorie/macro targets from BMR/TDEE | adults | daily numbers | aggressive deficits if unchecked (→ `calorieSafety`) | personalization depth vs wellness line |
| 3 | Condition nutrient rules (DRAFT) | disease-context guidance | per-nutrient limits for diabetes/HTN/CKD/dyslipidemia | users with self-reported conditions | rule-based warnings/limits | wrong thresholds = clinical harm | US: patient-facing = likely beyond general wellness; CDS criteria met? India: CDSCO SaMD scope; FSSAI claim rules |
| 4 | Allergen exposure warning | ingredient safety | "possible exposure to your logged allergen" | allergy users | `safety_warning` | false negative = severe harm; false positive = anxiety | wording standard ("may contain", cross-contact); never claim verified-safe |
| 5 | Life-stage blocks | safety gate | features unavailable; refer to professional | pregnancy, lactation, <18 | suppression + referral | withholding vs wrongful advice — err suppression | consent/age-verification standard (COPPA-adjacent, DPDP children provisions) |
| 6 | Medication/interaction escalation | safety gate | none — route to prescriber | medicated users | review path only | unreviewed interaction content blocked today | minimum viable safe content without pharmacy licensure? |
| 7 | `calorieSafety` floor policy | deficit guardrail | none yet (inactive module) | adults with anthropometrics | floor + review flags | wrong floor = eating-disorder-relevant harm | dietitian protocol sign-off; ED-population exclusion criteria |
| 8 | Supplement cautions (47 DRAFT rules) | supplement safety | none (unpublished) | supplement users | currently nothing | activation without review = high | FDA supplement claims; FSSAI nutraceutical rules |
| 9 | Scenario decision outcomes | safety routing | escalation/review/warning/ask | all | 5 typed outcomes | wrong routing = missed escalation | outcome wording approved per population |
| 10 | Trainer/nutritionist access | coaching | professionals view member data | members | shared logs/scores | privacy breach, scope creep | consent granularity; India DPDP; US state health-privacy laws; qualification verification |

## Cross-cutting unresolved questions (for counsel + clinical lead)

1. Does surfacing any condition-specific numeric target constitute practice of medicine/dietetics in the launch states/countries?
2. Are self-reported conditions sufficient basis, or is verification required before personalization?
3. India: does the app constitute a "medical device" under MDR-2017 given nutrition-only claims? FSSAI claims boundary for food-scoring language.
4. US: is any output CDS-eligible (HCP-directed, transparent basis) vs patient-directed (likely not exempt)?
5. Cross-border data flows: DPDP + state-law consent requirements for health data of Indian users processed in US infra.
6. Liability wording for `safety_warning` (allergy) — approved copy must never imply verified safety.
