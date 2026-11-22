# PORTION_INTELLIGENCE_VALIDATION

`evaluatePortion` verified (`tests/ingredientImpact.test.js`): share = kcal/target×100 over the actual grams; ≥30% + portion-sensitive category → `portion` dimension; verdict bands small/moderate/large. Household-serving inputs stay unconverted unless a verified servingId exists (serving infrastructure from FL-001); raw/cooked via profile preparationType + explicit yield factor only. Missing target → `INCOMPLETE_DATA`, never assumed.
