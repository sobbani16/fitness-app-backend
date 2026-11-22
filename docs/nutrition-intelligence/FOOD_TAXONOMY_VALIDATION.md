# FOOD_TAXONOMY_VALIDATION

Tests (`ingredientImpact.test.js`, +5): almonds → nuts_seeds+calorie_dense, NOT cooking_fat/legumes (band bug found+fixed: pure-fat and legume bands collided with nuts — fixed via protein/fiber discriminators); ghee → cooking_fat; gulab jamun → ESTIMATED name-hint only (composition unverified — correct per spec); empty → UNKNOWN; rice → refined_carb + "never a health verdict". All 22 suite tests green.
