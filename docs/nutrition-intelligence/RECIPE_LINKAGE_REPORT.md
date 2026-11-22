# RECIPE_CLASSIFICATION_AND_LINKAGE_FINAL — H5 audit (read-only)

**17 unlinked `RecipeIngredient` lines reviewed — 0 auto-linked (correct outcome).**

| Line | Recipes | Verdict |
|---|---|---|
| "vegetables" ×6 | Tuna bowl, Hummus, Turkey wrap, Stir-fry, Frittata, Fish tacos, Shrimp | AMBIGUOUS — name-matches only composite dishes (biryani, pasta sauces); linking would inject wrong nutrients. Needs a `mixed vegetables` catalog item. |
| "wrap" 80g | Turkey wrap | AMBIGUOUS — only match "Dumpling wrappers" (wrong food). Needs `tortilla/wrap` item. |
| "tuna" 120g | Tuna bowl | NO MATCH — catalog lacks tuna entirely. Needs `tuna, canned in water` (USDA FDC). |
| "cottage cheese" 200g | Cottage cheese+fruit | NO MATCH — needs catalog item. |
| "protein bar", "almond milk", "mixed berries", "mixed fruit", "mixed greens", "turkey meatballs", "mixed vegetables" | various | NO MATCH — catalog gaps; several need composite/generic entries. |

**Policy verified:** unlinked lines contribute no nutrients/allergen conclusions; recipe stays "incomplete composition". **Owner path:** create ~10 catalog items (tuna canned, cottage cheese, mixed veg, mixed berries, tortilla, almond milk, protein bar generic, turkey meatballs, mixed greens, mixed fruit), re-run linkage — all are plain name-matches with USDA FDC equivalents available. No DB writes performed.
