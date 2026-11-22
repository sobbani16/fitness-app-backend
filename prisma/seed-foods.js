// Food + recipe catalog seed — exported from dev DB on 2026-11-17.
// Edit/extend the arrays below, then run:  node prisma/seed-foods.js
// Idempotent: upserts by normalizedName / (creatorId=null, recipeName).
// NOTE: nutrition values are per the source listed; review before trusting.

const { getPrisma } = require('../src/lib/prisma');

const INGREDIENTS = [
  { name: "Almonds, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50, fiberPer100g: 12.5 },
  { name: "Avocado", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 8.5, fatPer100g: 15, fiberPer100g: 6.7 },
  { name: "Banana", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3, fiberPer100g: 2.6 },
  { name: "Bread, barley", fdcId: "2707788", caloriesPer100g: 274, proteinPer100g: 10.67, carbsPer100g: 47.54, fatPer100g: 4.53, fiberPer100g: 4 },
  { name: "Bread, black", fdcId: "2707764", caloriesPer100g: 250, proteinPer100g: 8.7, carbsPer100g: 47.5, fatPer100g: 3.1, fiberPer100g: 6.5 },
  { name: "Bread, cinnamon", fdcId: "2707620", caloriesPer100g: 253, proteinPer100g: 7.05, carbsPer100g: 44.38, fatPer100g: 5.29, fiberPer100g: 3.5 },
  { name: "Bread, oatmeal", fdcId: "2707768", caloriesPer100g: 269, proteinPer100g: 8.4, carbsPer100g: 48.5, fatPer100g: 4.4, fiberPer100g: 4 },
  { name: "Bread, onion", fdcId: "2707633", caloriesPer100g: 238, proteinPer100g: 8.81, carbsPer100g: 44.32, fatPer100g: 2.95, fiberPer100g: 1.7 },
  { name: "Bread, potato", fdcId: "2707642", caloriesPer100g: 266, proteinPer100g: 12.5, carbsPer100g: 47.07, fatPer100g: 3.13, fiberPer100g: 6.3 },
  { name: "Bread, rice", fdcId: "2707794", caloriesPer100g: 248, proteinPer100g: 4.31, carbsPer100g: 45.78, fatPer100g: 5.24, fiberPer100g: 4.3 },
  { name: "Bread, rye", fdcId: "2707755", caloriesPer100g: 259, proteinPer100g: 8.5, carbsPer100g: 48.3, fatPer100g: 3.3, fiberPer100g: 5.8 },
  { name: "Bread, soy", fdcId: "2707790", caloriesPer100g: 267, proteinPer100g: 16.4, carbsPer100g: 41.95, fatPer100g: 3.84, fiberPer100g: 4.4 },
  { name: "Bread, white", fdcId: "2707598", caloriesPer100g: 267, proteinPer100g: 9.43, carbsPer100g: 49.2, fatPer100g: 3.59, fiberPer100g: 2.3 },
  { name: "Broccoli, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 34, proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4, fiberPer100g: 2.6 },
  { name: "Brown rice, cooked", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 123, proteinPer100g: 2.7, carbsPer100g: 25.6, fatPer100g: 1, fiberPer100g: 1.8 },
  { name: "Chicken breast, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 120, proteinPer100g: 22.5, carbsPer100g: 0, fatPer100g: 2.6, fiberPer100g: 0.0 },
  { name: "Chickpeas, cooked", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 164, proteinPer100g: 8.9, carbsPer100g: 27, fatPer100g: 2.6, fiberPer100g: 7.6 },
  { name: "Eggs, whole, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11, fiberPer100g: 0.0 },
  { name: "Greek yogurt, plain", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 59, proteinPer100g: 10, carbsPer100g: 3.6, fatPer100g: 0.7, fiberPer100g: 0.0 },
  { name: "Oats, rolled, dry", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 389, proteinPer100g: 17, carbsPer100g: 66, fatPer100g: 7, fiberPer100g: 10.1 },
  { name: "Quinoa, cooked", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 120, proteinPer100g: 4.4, carbsPer100g: 21, fatPer100g: 1.9, fiberPer100g: 2.8 },
  { name: "Salmon, Atlantic, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13, fiberPer100g: 0.0 },
  { name: "Spinach, raw", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 23, proteinPer100g: 2.9, carbsPer100g: 3.6, fatPer100g: 0.4, fiberPer100g: 2.2 },
  { name: "Sweet potato, baked", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 90, proteinPer100g: 2, carbsPer100g: 21, fatPer100g: 0.1, fiberPer100g: 3.0 },
  { name: "Whey protein powder", fdcId: null /* was dummy — unmatched FDC */, caloriesPer100g: 400, proteinPer100g: 80, carbsPer100g: 10, fatPer100g: 5, fiberPer100g: 0.0 },
];

const RECIPES = [
  {
    recipeName: "Almonds (30g)", cuisine: null, mealType: "snack", servings: 1, portionG: 30,
    calories: 175, proteinG: 6, carbsG: 6, fatG: 15, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "almonds", amountG: 30, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Apple with peanut butter", cuisine: null, mealType: "snack", servings: 1, portionG: 180,
    calories: 250, proteinG: 7, carbsG: 30, fatG: 12, fiberG: 5,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "apple", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "peanut butter", amountG: 30, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Avocado toast with egg", cuisine: null, mealType: "breakfast", servings: 1, portionG: 220,
    calories: 400, proteinG: 18, carbsG: 35, fatG: 22, fiberG: 6,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "avocado", amountG: 70, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "eggs", amountG: 50, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "whole wheat bread", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Baked salmon with asparagus", cuisine: null, mealType: "dinner", servings: 1, portionG: 350,
    calories: 480, proteinG: 42, carbsG: 10, fatG: 28, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "asparagus", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "salmon", amountG: 180, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Banana", cuisine: null, mealType: "snack", servings: 1, portionG: 120,
    calories: 105, proteinG: 1, carbsG: 27, fatG: 0, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "banana", amountG: 120, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Chicken breast with sweet potato", cuisine: null, mealType: "lunch", servings: 1, portionG: 380,
    calories: 460, proteinG: 48, carbsG: 40, fatG: 8, fiberG: 5,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "chicken breast", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "sweet potato", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Chicken stir-fry with rice", cuisine: null, mealType: "lunch", servings: 1, portionG: 400,
    calories: 480, proteinG: 38, carbsG: 50, fatG: 12, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "chicken breast", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "rice", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Chicken thigh with brown rice", cuisine: null, mealType: "dinner", servings: 1, portionG: 400,
    calories: 520, proteinG: 40, carbsG: 45, fatG: 18, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "brown rice", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "chicken thigh", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Cottage cheese and fruit", cuisine: null, mealType: "breakfast", servings: 1, portionG: 300,
    calories: 280, proteinG: 28, carbsG: 30, fatG: 5, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "cottage cheese", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "mixed fruit", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Egg frittata with veggies", cuisine: null, mealType: "dinner", servings: 1, portionG: 350,
    calories: 420, proteinG: 30, carbsG: 15, fatG: 25, fiberG: 5,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "eggs", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Eggs and whole wheat toast", cuisine: null, mealType: "breakfast", servings: 1, portionG: 250,
    calories: 380, proteinG: 22, carbsG: 30, fatG: 18, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "eggs", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "whole wheat bread", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Greek yogurt", cuisine: null, mealType: "snack", servings: 1, portionG: 150,
    calories: 100, proteinG: 17, carbsG: 6, fatG: 1, fiberG: 0,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "greek yogurt", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Greek yogurt with granola", cuisine: null, mealType: "breakfast", servings: 1, portionG: 280,
    calories: 320, proteinG: 25, carbsG: 40, fatG: 8, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "granola", amountG: 80, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "greek yogurt", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Grilled chicken salad", cuisine: null, mealType: "lunch", servings: 1, portionG: 350,
    calories: 450, proteinG: 45, carbsG: 15, fatG: 22, fiberG: 6,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "chicken breast", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "mixed greens", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "olive oil", amountG: 15, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Grilled fish tacos", cuisine: null, mealType: "dinner", servings: 1, portionG: 350,
    calories: 450, proteinG: 38, carbsG: 40, fatG: 14, fiberG: 5,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "tortillas", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 50, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "white fish", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Hard boiled eggs (2)", cuisine: null, mealType: "snack", servings: 1, portionG: 100,
    calories: 155, proteinG: 13, carbsG: 1, fatG: 11, fiberG: 0,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "eggs", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Hummus with veggies", cuisine: null, mealType: "snack", servings: 1, portionG: 200,
    calories: 180, proteinG: 8, carbsG: 20, fatG: 8, fiberG: 6,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "hummus", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Lean beef with vegetables", cuisine: null, mealType: "dinner", servings: 1, portionG: 400,
    calories: 500, proteinG: 45, carbsG: 20, fatG: 25, fiberG: 6,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "lean beef", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "mixed vegetables", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Lentil soup with bread", cuisine: null, mealType: "lunch", servings: 1, portionG: 400,
    calories: 420, proteinG: 22, carbsG: 55, fatG: 8, fiberG: 12,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "bread", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "lentils", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Oatmeal with berries", cuisine: null, mealType: "breakfast", servings: 1, portionG: 300,
    calories: 350, proteinG: 12, carbsG: 55, fatG: 8, fiberG: 7,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "milk", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "mixed berries", amountG: 80, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "oats", amountG: 120, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Overnight oats", cuisine: null, mealType: "breakfast", servings: 1, portionG: 300,
    calories: 370, proteinG: 15, carbsG: 50, fatG: 10, fiberG: 8,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "chia seeds", amountG: 10, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "milk", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "oats", amountG: 120, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Protein bar", cuisine: null, mealType: "snack", servings: 1, portionG: 60,
    calories: 200, proteinG: 20, carbsG: 22, fatG: 7, fiberG: 3,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "protein bar", amountG: 60, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Protein smoothie", cuisine: null, mealType: "breakfast", servings: 1, portionG: 400,
    calories: 350, proteinG: 35, carbsG: 40, fatG: 5, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "almond milk", amountG: 250, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "banana", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "protein powder", amountG: 30, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Salmon with quinoa", cuisine: null, mealType: "lunch", servings: 1, portionG: 350,
    calories: 520, proteinG: 40, carbsG: 35, fatG: 22, fiberG: 5,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "quinoa", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "salmon", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Shrimp stir-fry", cuisine: null, mealType: "dinner", servings: 1, portionG: 380,
    calories: 400, proteinG: 35, carbsG: 35, fatG: 12, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "rice", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "shrimp", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 80, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Tuna bowl", cuisine: null, mealType: "lunch", servings: 1, portionG: 350,
    calories: 440, proteinG: 42, carbsG: 35, fatG: 14, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "rice", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "tuna", amountG: 120, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 80, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Turkey meatballs with pasta", cuisine: null, mealType: "dinner", servings: 1, portionG: 400,
    calories: 510, proteinG: 38, carbsG: 50, fatG: 15, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "pasta", amountG: 150, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "turkey meatballs", amountG: 200, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
  {
    recipeName: "Turkey wrap", cuisine: null, mealType: "lunch", servings: 1, portionG: 300,
    calories: 420, proteinG: 35, carbsG: 40, fatG: 12, fiberG: 4,
    description: null, nutritionSource: null,
    ingredients: [
      { ingredientName: "turkey breast", amountG: 120, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "vegetables", amountG: 100, calories: null, proteinG: null, carbsG: null, fatG: null },
      { ingredientName: "wrap", amountG: 80, calories: null, proteinG: null, carbsG: null, fatG: null },
    ],
  },
];

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const prisma = getPrisma();
  for (const ing of INGREDIENTS) {
    const data = {
      caloriesPer100g: ing.caloriesPer100g, proteinPer100g: ing.proteinPer100g,
      carbsPer100g: ing.carbsPer100g, fatPer100g: ing.fatPer100g, fiberPer100g: ing.fiberPer100g,
    };
    const existing = await prisma.ingredient.findFirst({ where: { normalizedName: norm(ing.name) } });
    if (existing) await prisma.ingredient.update({ where: { id: existing.id }, data });
    else await prisma.ingredient.create({ data: { name: ing.name, normalizedName: norm(ing.name), fdcId: ing.fdcId, source: 'seed', ...data } });
  }
  for (const r of RECIPES) {
    const { ingredients, ...data } = r;
    const existing = await prisma.recipe.findFirst({ where: { recipeName: r.recipeName, creatorId: 'system' } });
    const recipe = existing
      ? await prisma.recipe.update({ where: { id: existing.id }, data: { ...data, isSystem: true } })
      : await prisma.recipe.create({ data: { ...data, creatorId: 'system', isSystem: true } });
    // Reconcile lines in place — never deleteMany+recreate; preserves line ids
    // and any nutritionSnapshot/user edits on unchanged lines.
    const oldLines = new Map((existing ? await prisma.recipeIngredient.findMany({ where: { recipeId: recipe.id } }) : []).map((l) => [norm(l.ingredientName), l]));
    const seen = new Set();
    for (const ri of ingredients) {
      const match = await prisma.ingredient.findFirst({ where: { normalizedName: norm(ri.ingredientName) } });
      const k = norm(ri.ingredientName); seen.add(k);
      const upd = { ingredientId: match?.id ?? null, amountG: ri.amountG, calories: ri.calories, proteinG: ri.proteinG, carbsG: ri.carbsG, fatG: ri.fatG };
      const o = oldLines.get(k);
      if (!o) await prisma.recipeIngredient.create({ data: { recipeId: recipe.id, ingredientName: ri.ingredientName, ...upd } });
      else if (['ingredientId', 'amountG', 'calories', 'proteinG', 'carbsG', 'fatG'].some((f) => o[f] !== upd[f])) await prisma.recipeIngredient.update({ where: { id: o.id }, data: upd });
    }
    for (const o of oldLines.values()) if (!seen.has(norm(o.ingredientName))) await prisma.recipeIngredient.delete({ where: { id: o.id } });
  }
  console.log(`Seeded ${INGREDIENTS.length} ingredients, ${RECIPES.length} recipes.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
