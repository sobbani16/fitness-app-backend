# FOOD_CLASSIFICATION_ARCHITECTURE (Sprint D, classify-v1)

`classifyFood({name, per100})` in `ingredientImpact.js` — deterministic multi-label. Evidence ladder: `DERIVED_FROM_VERIFIED_DATA` (nutrient bands on verified per-100g) > `ESTIMATED` (name/culinary hints only) > `UNKNOWN` (no usable data). Bands (documented engineering thresholds): calorie_dense kcal≥450/100g; protein_foods protein≥18; cooking_fat fat≥45 AND ~0 protein+fiber (separates ghee/oil from nuts); legumes_soy fiber≥5+protein≥8+fat<15 (separates legumes from nuts); fruit_vegetable kcal≤80+fiber≥2. Name hints cover nuts/dairy/oils/indian sweets/fried/SSB/processed meat/legumes/whole+refined grains/sodium/protein foods — name hints are ESTIMATED-tier and never override nutrient derivation.

**Consumer:** `POST /food-logs/intelligence` — classification is server-derived; client `categoryId` input is ignored entirely (removed trust). `impact.classification` carries version+state+basis.
