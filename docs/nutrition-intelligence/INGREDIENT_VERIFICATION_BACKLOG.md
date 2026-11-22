# INGREDIENT_VERIFICATION_BACKLOG — prioritized triage

**Generated:** 2026-11-21T21:10:27.607Z · `node scripts/ingredient-verification-backlog.js` · full row data: `var/ingredient-backlog.json`

## Summary

| Category | Count | Meaning |
|---|---|---|
| verified | 18 | IngredientNutritionProfile with verifiedAt (USDA-backed) |
| proxy | 145 | Has fdcId but no profile — next-up for the population pipeline |
| profile_unverified | 0 | Profile exists, not verified |
| estimate | 321 | per-100g values present, no provenance — never treat as verified |
| missing | 0 | No values at all |
| flags | — | zero-kcal rows: 2 · claims source='usda' w/o fdcId: 0 |

Ingredients referenced by recipe lines or logged foods: **229** — these rank first below (usageScore = 3×logged + 2×recipe).

## Rules for this backlog

- Never invent nutrient values; "estimate" rows keep honest `coverage` semantics — missing is never zero.
- Verified/proxy/estimate/missing are disjoint; a proxy row graduates only via the population importer (source match + profile build), not by copying per-100g estimates into a profile.
- Dedupe is separate work (D12) — canonical mapping must preserve historical FoodLog/RecipeIngredient name references.

## Top 40 unverified by usage

| # | Ingredient | Source | fdcId | Category | Usage | Flags |
|---|---|---|---|---|---|---|
| 1 | Water | humai-catalog | — | estimate | 250 | zero_kcal |
| 2 | Vegetable cooking oil | humai-catalog | — | estimate | 172 | — |
| 3 | Onion, raw | humai-catalog | — | estimate | 146 | — |
| 4 | Tomato, raw | humai-catalog | — | estimate | 82 | — |
| 5 | Olive oil | humai-catalog | — | estimate | 72 | — |
| 6 | Soy sauce | humai-catalog | — | estimate | 52 | — |
| 7 | Black pepper | humai-catalog | — | estimate | 50 | — |
| 8 | Lemon juice | humai-catalog | — | estimate | 44 | — |
| 9 | Rice, white, dry | humai-catalog | — | estimate | 44 | — |
| 10 | Plain yogurt curd | humai-catalog | — | estimate | 36 | — |
| 11 | Carrot, raw | humai-catalog | — | estimate | 30 | — |
| 12 | Green peas, raw | humai-catalog | — | estimate | 28 | — |
| 13 | Sesame oil | humai-catalog | — | estimate | 28 | — |
| 14 | Garlic, raw | humai-catalog | — | estimate | 26 | — |
| 15 | Milk, whole | humai-catalog | — | estimate | 26 | — |
| 16 | Coconut flesh, fresh | humai-catalog | — | estimate | 24 | — |
| 17 | White sugar | humai-catalog | — | estimate | 24 | — |
| 18 | Cashew nuts, raw | humai-catalog | — | estimate | 20 | — |
| 19 | Chili flakes | humai-catalog | — | estimate | 20 | fiber_unknown |
| 20 | Ghee clarified butter | humai-catalog | — | estimate | 20 | — |
| 21 | Green chili, raw | humai-catalog | — | estimate | 20 | — |
| 22 | Potato, raw | humai-catalog | — | estimate | 20 | — |
| 23 | Mustard seeds | humai-catalog | — | estimate | 18 | — |
| 24 | Tamarind pulp, unsweetened | humai-catalog | — | estimate | 18 | — |
| 25 | Toor/arhar dal, dry | humai-catalog | — | estimate | 18 | — |
| 26 | Paneer, full-fat plain | humai-catalog | — | estimate | 16 | — |
| 27 | Paprika | humai-catalog | — | estimate | 16 | — |
| 28 | Red chili powder, dry | humai-catalog | — | estimate | 16 | — |
| 29 | Sesame seeds | humai-catalog | — | estimate | 16 | — |
| 30 | Avocado | humai-catalog | — | estimate | 14 | — |
| 31 | Avocado | seed | — | estimate | 14 | — |
| 32 | Chicken breast skinless, raw | humai-catalog | — | estimate | 14 | — |
| 33 | Coconut oil | humai-catalog | — | estimate | 14 | — |
| 34 | Fish sauce | humai-catalog | — | estimate | 14 | — |
| 35 | Mayonnaise | humai-catalog | — | estimate | 14 | — |
| 36 | Peanuts, raw | humai-catalog | — | estimate | 14 | — |
| 37 | Chicken broth | humai-catalog | — | estimate | 12 | — |
| 38 | Chicken thigh skinless, raw | humai-catalog | — | estimate | 12 | — |
| 39 | Lime juice | humai-catalog | — | estimate | 12 | — |
| 40 | Marinara sauce | humai-catalog | — | estimate | 12 | — |
