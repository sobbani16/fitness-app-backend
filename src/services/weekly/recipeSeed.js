const { getPrisma } = require('../../lib/prisma');
const { recipes } = require('./catalog');
async function seedRecipes() {
  await require('./centralRecipes').importReviewedIngredients(getPrisma());
  // Versioned IDs never overwrite the old catalog or historical recipe references.
  await getPrisma().$transaction(async tx => {
    for (const recipe of recipes) {
      const { ingredients, ...data } = recipe;
      const existing = await tx.recipe.findUnique({ where: { id: data.id }, include: { ingredients: true } });
      if (existing) {
        if (!require('./catalog').attributable(existing)) throw new Error(`Catalog record ${data.id} differs; publish a new version instead of overwriting history.`);
        continue;
      }
      await tx.recipe.create({ data: { ...data, ingredients: { create: ingredients } } });
    }
  }, { timeout: 60000 });
  return { seeded: recipes.length };
}
// Retain the fixture shape for older deterministic generator tests.
const MEAL_DB = Object.fromEntries(['breakfast','lunch','dinner','snack'].map(type => [type, recipes.filter(r=>r.mealType===type).map(r=>({ ...r, foodName:r.recipeName, ingredients:r.ingredients.map(i=>({name:i.ingredientName,g:i.amountG})) }))]));
if (require.main === module) {
  require('dotenv').config();
  seedRecipes().then(console.log).catch(e=>{ console.error(e.message);process.exitCode=1; }).finally(()=>getPrisma().$disconnect());
}
module.exports = { seedRecipes, MEAL_DB };
