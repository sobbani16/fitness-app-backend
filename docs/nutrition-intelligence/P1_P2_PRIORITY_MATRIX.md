# P1_P2_PRIORITY_MATRIX — 52 blocked scenarios ranked for implementation

**Criteria:** user safety · existing dependency reuse · nutrition-data reliability · user benefit · engineering complexity · clinical-approval need · regulatory exposure. Rank = recommended build order.

## Tier 1 — Foundation unlocks (build first; many scenarios depend on them)

| # | Capability | Unlocks | Complexity | Clinical? | Notes |
|---|---|---|---|---|---|
| 1 | **Multi-day trend layer** (7/14/30d windows over food logs, weights, scores — coverage-aware) | A08 A09 F07 L01 L03 L04 L05, D01–D09 trends, E09 | M | no (reporting) | highest-leverage engineering piece; pure aggregation, no claims |
| 2 | **Symptom/context association layer** (link reported symptoms to logged foods/meals over days — cautious language, never diagnosis) | H01–H07, D02, E04, G04 | M | copy review | reuses existing symptomLog infra from activity-safety |
| 3 | **Food-data confidence plumbing** (estimate ranges + provenance through logging→score) | C03 C04 C07, K10 partially, L06 | M | no | ingredient `estimate` class already exists; expose range to consumers |
| 4 | **Meal-time analytics** (distribution of intake across local day, TZ-aware via `localDay`) | E01 E03 E09 E10, K10 | M | no | `dayRangeUtc` exists; aggregate only |

## Tier 2 — Goal/explanation features (wellness-safe, no clinical approval)

| ID | Scenario | Needs | Notes |
|---|---|---|---|
| A08/A09 | strength-loss/fat-loss tension, plateau-with-adherence | trend layer (1) + outcome divergence fn ✔ | `detectOutcomeDivergence` ready; needs trend input |
| E05/E06 | hunger during deficit / fullness during gain | trend + symptom layer | review deficit size, protein, fiber — explanatory, not prescriptive |
| F02/F03/F06/F07 | fueling for training, fatigue, performance drop | activity history + energy adequacy + symptom layer | sports-nutrition education only |
| B05 | low carbs + endurance | activity × intake | fueling suitability, no diagnosis |
| G01/G03/G04/G07/G09 | sleep/stress/caffeine/fatigue | symptom layer + sleep data | reviewed education only; escalation already exists |
| E01/E10 | IF / religious fasting | meal-time analytics (4) | support pattern, no judgment |
| K10 | TZ change / post-midnight log | `localDay` exists — needs boundary audit | engineering only, high data-reliability value |
| L01 | sodium→water fluctuation explainer | trend layer | education |
| L04/L05 | strength/weight divergence | trend + workout history | education |

## Tier 3 — Food quality / substitution (data-dependent)

| ID | Scenario | Needs | Notes |
|---|---|---|---|
| C03/C04 | Indian sweets, deep-fried | recipe/oil-absorption estimates + provenance (3) | ingredient research data exists partially |
| C07 | nuts/seeds/avocado fat quality | fat-composition data | data gap: unsaturated fat fields |
| D08 | omega-3 coverage | nutrient breadth | data + dietitian |
| D09 | limited food variety | trend + diversity metric | definable by eng |
| L06/L07/L08 | restaurants, budget, travel | substitution engine + cuisine data | L07 budget needs product data |

## Tier 4 — Clinically restricted (engineering may proceed; activation gated)

| ID | Scenario | Needs | Gate |
|---|---|---|---|
| D03–D06 | B12/iron/calcium/vitD adequacy patterns | micronutrient catalog breadth + dietitian ranges | dietitian for thresholds; surfacing after approval |
| I03/I04/I06 | TG/LDL/HTN personalized guidance | `condition_rules` flag ✔ created + approved rules (0 today) | clinical |
| I09 | PCOS/thyroid framing | approved guidance copy | clinical |
| J02/J03 | supplement overlap, creatine education | `supplement_safety` flag ✔ + pharmacist content | clinical |
| B08 | deliberate low-carb diet evaluation | suitability + medical constraints | clinical-adjacent review |

## Explicit non-goals this phase

- Anything requiring a threshold (dietitian sets numbers, not engineers).
- Trend layer must remain reporting-oriented — it feeds review/feedback, it does not diagnose.
