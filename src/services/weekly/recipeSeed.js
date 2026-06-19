const { getPrisma } = require('../../lib/prisma');

const MEAL_DB = {
  breakfast: [
    { foodName: 'Oatmeal with berries', portionG: 300, calories: 350, proteinG: 12, carbsG: 55, fatG: 8, fiberG: 7, ingredients: [{ name: 'oats', g: 120 }, { name: 'mixed berries', g: 80 }, { name: 'milk', g: 100 }] },
    { foodName: 'Eggs and whole wheat toast', portionG: 250, calories: 380, proteinG: 22, carbsG: 30, fatG: 18, fiberG: 3, ingredients: [{ name: 'eggs', g: 150 }, { name: 'whole wheat bread', g: 100 }] },
    { foodName: 'Greek yogurt with granola', portionG: 280, calories: 320, proteinG: 25, carbsG: 40, fatG: 8, fiberG: 3, ingredients: [{ name: 'greek yogurt', g: 200 }, { name: 'granola', g: 80 }] },
    { foodName: 'Protein smoothie', portionG: 400, calories: 350, proteinG: 35, carbsG: 40, fatG: 5, fiberG: 4, ingredients: [{ name: 'protein powder', g: 30 }, { name: 'banana', g: 100 }, { name: 'almond milk', g: 250 }] },
    { foodName: 'Avocado toast with egg', portionG: 220, calories: 400, proteinG: 18, carbsG: 35, fatG: 22, fiberG: 6, ingredients: [{ name: 'whole wheat bread', g: 100 }, { name: 'avocado', g: 70 }, { name: 'eggs', g: 50 }] },
    { foodName: 'Overnight oats', portionG: 300, calories: 370, proteinG: 15, carbsG: 50, fatG: 10, fiberG: 8, ingredients: [{ name: 'oats', g: 120 }, { name: 'milk', g: 150 }, { name: 'chia seeds', g: 10 }] },
    { foodName: 'Cottage cheese and fruit', portionG: 300, calories: 280, proteinG: 28, carbsG: 30, fatG: 5, fiberG: 3, ingredients: [{ name: 'cottage cheese', g: 200 }, { name: 'mixed fruit', g: 100 }] },
  ],
  lunch: [
    { foodName: 'Grilled chicken salad', portionG: 350, calories: 450, proteinG: 45, carbsG: 15, fatG: 22, fiberG: 6, ingredients: [{ name: 'chicken breast', g: 150 }, { name: 'mixed greens', g: 100 }, { name: 'olive oil', g: 15 }] },
    { foodName: 'Turkey wrap', portionG: 300, calories: 420, proteinG: 35, carbsG: 40, fatG: 12, fiberG: 4, ingredients: [{ name: 'turkey breast', g: 120 }, { name: 'wrap', g: 80 }, { name: 'vegetables', g: 100 }] },
    { foodName: 'Salmon with quinoa', portionG: 350, calories: 520, proteinG: 40, carbsG: 35, fatG: 22, fiberG: 5, ingredients: [{ name: 'salmon', g: 150 }, { name: 'quinoa', g: 100 }] },
    { foodName: 'Chicken stir-fry with rice', portionG: 400, calories: 480, proteinG: 38, carbsG: 50, fatG: 12, fiberG: 4, ingredients: [{ name: 'chicken breast', g: 150 }, { name: 'rice', g: 150 }, { name: 'vegetables', g: 100 }] },
    { foodName: 'Lentil soup with bread', portionG: 400, calories: 420, proteinG: 22, carbsG: 55, fatG: 8, fiberG: 12, ingredients: [{ name: 'lentils', g: 150 }, { name: 'bread', g: 100 }] },
    { foodName: 'Tuna bowl', portionG: 350, calories: 440, proteinG: 42, carbsG: 35, fatG: 14, fiberG: 4, ingredients: [{ name: 'tuna', g: 120 }, { name: 'rice', g: 150 }, { name: 'vegetables', g: 80 }] },
    { foodName: 'Chicken breast with sweet potato', portionG: 380, calories: 460, proteinG: 48, carbsG: 40, fatG: 8, fiberG: 5, ingredients: [{ name: 'chicken breast', g: 150 }, { name: 'sweet potato', g: 200 }] },
  ],
  dinner: [
    { foodName: 'Lean beef with vegetables', portionG: 400, calories: 500, proteinG: 45, carbsG: 20, fatG: 25, fiberG: 6, ingredients: [{ name: 'lean beef', g: 200 }, { name: 'mixed vegetables', g: 200 }] },
    { foodName: 'Baked salmon with asparagus', portionG: 350, calories: 480, proteinG: 42, carbsG: 10, fatG: 28, fiberG: 4, ingredients: [{ name: 'salmon', g: 180 }, { name: 'asparagus', g: 150 }] },
    { foodName: 'Chicken thigh with brown rice', portionG: 400, calories: 520, proteinG: 40, carbsG: 45, fatG: 18, fiberG: 3, ingredients: [{ name: 'chicken thigh', g: 150 }, { name: 'brown rice', g: 150 }] },
    { foodName: 'Shrimp stir-fry', portionG: 380, calories: 400, proteinG: 35, carbsG: 35, fatG: 12, fiberG: 4, ingredients: [{ name: 'shrimp', g: 150 }, { name: 'rice', g: 150 }, { name: 'vegetables', g: 80 }] },
    { foodName: 'Grilled fish tacos', portionG: 350, calories: 450, proteinG: 38, carbsG: 40, fatG: 14, fiberG: 5, ingredients: [{ name: 'white fish', g: 150 }, { name: 'tortillas', g: 100 }, { name: 'vegetables', g: 50 }] },
    { foodName: 'Turkey meatballs with pasta', portionG: 400, calories: 510, proteinG: 38, carbsG: 50, fatG: 15, fiberG: 4, ingredients: [{ name: 'turkey meatballs', g: 200 }, { name: 'pasta', g: 150 }] },
    { foodName: 'Egg frittata with veggies', portionG: 350, calories: 420, proteinG: 30, carbsG: 15, fatG: 25, fiberG: 5, ingredients: [{ name: 'eggs', g: 150 }, { name: 'vegetables', g: 200 }] },
  ],
  snack: [
    { foodName: 'Protein bar', portionG: 60, calories: 200, proteinG: 20, carbsG: 22, fatG: 7, fiberG: 3, ingredients: [{ name: 'protein bar', g: 60 }] },
    { foodName: 'Almonds (30g)', portionG: 30, calories: 175, proteinG: 6, carbsG: 6, fatG: 15, fiberG: 3, ingredients: [{ name: 'almonds', g: 30 }] },
    { foodName: 'Apple with peanut butter', portionG: 180, calories: 250, proteinG: 7, carbsG: 30, fatG: 12, fiberG: 5, ingredients: [{ name: 'apple', g: 150 }, { name: 'peanut butter', g: 30 }] },
    { foodName: 'Greek yogurt', portionG: 150, calories: 100, proteinG: 17, carbsG: 6, fatG: 1, fiberG: 0, ingredients: [{ name: 'greek yogurt', g: 150 }] },
    { foodName: 'Hard boiled eggs (2)', portionG: 100, calories: 155, proteinG: 13, carbsG: 1, fatG: 11, fiberG: 0, ingredients: [{ name: 'eggs', g: 100 }] },
    { foodName: 'Hummus with veggies', portionG: 200, calories: 180, proteinG: 8, carbsG: 20, fatG: 8, fiberG: 6, ingredients: [{ name: 'hummus', g: 100 }, { name: 'vegetables', g: 100 }] },
    { foodName: 'Banana', portionG: 120, calories: 105, proteinG: 1, carbsG: 27, fatG: 0, fiberG: 3, ingredients: [{ name: 'banana', g: 120 }] },
  ],
};

async function seedRecipes() {
  const prisma = getPrisma();
  const systemCreatorId = 'system';

  for (const [mealType, meals] of Object.entries(MEAL_DB)) {
    for (const meal of meals) {
      const recipe = await prisma.recipe.upsert({
        where: { recipeName: meal.foodName },
        update: {
          mealType,
          calories: meal.calories,
          proteinG: meal.proteinG,
          carbsG: meal.carbsG,
          fatG: meal.fatG,
          fiberG: meal.fiberG,
          portionG: meal.portionG,
          isSystem: true,
          servings: 1,
        },
        create: {
          creatorId: systemCreatorId,
          recipeName: meal.foodName,
          mealType,
          calories: meal.calories,
          proteinG: meal.proteinG,
          carbsG: meal.carbsG,
          fatG: meal.fatG,
          fiberG: meal.fiberG,
          portionG: meal.portionG,
          isSystem: true,
          servings: 1,
        },
      });

      await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
      await prisma.recipeIngredient.createMany({
        data: meal.ingredients.map((ing) => ({
          recipeId: recipe.id,
          ingredientName: ing.name,
          amountG: ing.g,
        })),
      });
    }
  }

  return { seeded: Object.values(MEAL_DB).flat().length };
}

if (require.main === module) {
  seedRecipes()
    .then((result) => {
      console.log('Seeded recipes:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seedRecipes, MEAL_DB };
