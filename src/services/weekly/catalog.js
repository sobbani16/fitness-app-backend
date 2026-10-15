const snapshot = require('../../data/weekly-nutrients.json');
const nutrients = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'];
const tags = { 173904: ['gluten'], 173424: ['egg','animal'], 171477: ['meat','animal'], 170894: ['milk','animal'], 172475: ['soy'] };
const specs = [
  ['breakfast','Yogurt, oats and banana',[[170894,200],[173904,50],[173944,100]],'medium'],
  ['breakfast','Egg, rice and broccoli bowl',[[173424,100],[168878,150],[170380,100],[171413,5]]],
  ['breakfast','Tofu, rice and banana bowl',[[172475,150],[168878,120],[173944,100]]],
  ['lunch','Chicken, rice and broccoli bowl',[[171477,150],[168878,180],[170380,150],[171413,10]],'medium'],
  ['lunch','Lentil, rice and broccoli bowl',[[172421,220],[168878,130],[170380,150],[171413,10]]],
  ['lunch','Tofu and lentil bowl',[[172475,180],[172421,150],[170380,150],[171413,5]]],
  ['dinner','Chicken and lentil bowl',[[171477,130],[172421,180],[170380,150],[171413,10]],'medium'],
  ['dinner','Tofu, rice and broccoli bowl',[[172475,200],[168878,180],[170380,150],[171413,10]]],
  ['dinner','Lentil and rice bowl',[[172421,250],[168878,180],[170380,100],[171413,15]]],
  ['snack','Banana and yogurt',[[173944,120],[170894,170]],'medium'],
  ['snack','Banana',[[173944,180]]],
  ['snack','Cooked egg and banana',[[173424,100],[173944,100]]],
];
const recipes = specs.map(([mealType, title, parts, budget = 'low'], index) => {
  const ingredients = parts.map(([id, amountG]) => ({ ingredientName: snapshot.foods[id].description, amountG }));
  const totals = Object.fromEntries(nutrients.map(key => [key, Math.round(parts.reduce((sum,[id,g]) => sum + snapshot.foods[id].per100g[key] * g / 100, 0) * 10) / 10]));
  return {
    id: `usda-weekly-v1-${index + 1}`, creatorId: 'system', isSystem: true,
    recipeName: `${title} · USDA v1`, mealType, servings: 1, portionG: parts.reduce((sum,[,g])=>sum+g,0), ...totals,
    description: 'Assembled meal; weigh edible ingredients in the named preparation state. No unlisted sauces or oils included.',
    nutritionSource: { version: snapshot.version, publisher: snapshot.source, retrievedAt: snapshot.retrievedAt, method: 'Sum of ingredient grams × USDA per-100g nutrients / 100; calculated estimate, not laboratory analysis of this recipe.',
      ingredients: parts.map(([id, grams]) => ({ ...snapshot.foods[id], grams })),
      tags: [...new Set(parts.flatMap(([id])=>tags[id] || []))], budget, cookingSkill: 'beginner',
      equipment: mealType === 'snack' || index === 0 ? [] : ['stovetop','microwave'],
    }, ingredients,
  };
});
// Compare stored recipes to the versioned catalog. Provenance labels alone cannot admit edited totals.
function attributable(recipe) {
  const known = recipes.find(r => r.id === recipe.id);
  return !!known && recipe.recipeName === known.recipeName && recipe.mealType === known.mealType && recipe.isSystem === true && recipe.nutritionSource?.version === snapshot.version &&
    require('node:util').isDeepStrictEqual(recipe.nutritionSource, known.nutritionSource) &&
    nutrients.concat('portionG').every(k => recipe[k] === known[k]) &&
    recipe.ingredients?.length === known.ingredients.length && known.ingredients.every(i => recipe.ingredients.some(x => x.ingredientName === i.ingredientName && x.amountG === i.amountG));
}
module.exports = { recipes, attributable, nutrients, version: snapshot.version };
