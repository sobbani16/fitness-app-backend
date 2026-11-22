# FOOD_CLASSIFICATION_COVERAGE — catalog audit (read-only)

- Ingredients in catalog: **420**; verified nutrition profiles: **18** (4.3%).
- Audit run (400 sampled): DERIVED 0 (nutrient mapping now fixed — see below), ESTIMATED 132, UNKNOWN 268.
- **UNKNOWN dominance is correct behavior**: no verified nutrients → no fabrication. Coverage ceiling = verified-profile coverage, a data problem not a classifier problem.
- Verified-profile re-audit (18, real IngredientNutrient rows): found 2 real defects → fixed:
  1. `Bread, rye` → `legumes_soy` (fiber5.8/pro8.5 hit the band) — legume band tightened to protein≥10 AND fat≤2.
  2. `Honey` → no label — added `added_sugar` name hint (sugar/jaggery/honey/syrup/molasses/candy).
  3. `whole-wheat` hyphen missed `whole wheat` regex — fixed to `whole[-\s]?wheat|atta`.
- Remaining honest limits: name-hint tier can't distinguish basmati/brown rice variants (stays unlabeled rather than guessing); mixed dishes ("chicken curry") get ESTIMATED single-labels only; `Pineapple` source row has calories=0 (data defect — logged, not compensated).
