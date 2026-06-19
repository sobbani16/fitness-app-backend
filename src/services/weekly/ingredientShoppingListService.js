const { getPrisma } = require('../../lib/prisma');

function guessCategory(ingredientName) {
  const name = ingredientName.toLowerCase();
  if (['chicken', 'beef', 'salmon', 'turkey', 'shrimp', 'tuna', 'fish', 'egg', 'lentil', 'chickpea', 'tofu'].some((p) => name.includes(p))) return 'protein';
  if (['rice', 'oat', 'bread', 'pasta', 'quinoa', 'potato', 'tortilla', 'wrap'].some((c) => name.includes(c))) return 'carbs';
  if (['yogurt', 'cheese', 'cottage', 'milk', 'cream'].some((d) => name.includes(d))) return 'dairy';
  if (['apple', 'banana', 'berr', 'fruit', 'vegetable', 'asparagus', 'broccoli', 'spinach', 'salad', 'mushroom'].some((f) => name.includes(f))) return 'produce';
  if (['olive oil', 'peanut butter', 'almond', 'hummus', 'chia'].some((f) => name.includes(f))) return 'pantry';
  return 'other';
}

function formatQuantity(name, grams) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)}kg`;
  if (name.toLowerCase().includes('egg')) return `${Math.ceil(grams / 50)} eggs`;
  if (name.toLowerCase().includes('yogurt')) return `${Math.ceil(grams / 150)} servings`;
  return `${Math.round(grams)}g`;
}

async function generateIngredientShoppingList(planId) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({
    where: { id: planId },
    include: { meals: { include: { recipe: { include: { ingredients: true } } } } },
  });
  if (!plan) throw new Error('Plan not found.');

  const allConfirmed = plan.meals.length > 0 && plan.meals.every((m) => m.confirmedByUser);
  if (!allConfirmed) throw new Error('All days must be confirmed before generating the shopping list.');

  const inventory = await prisma.foodInventory.findMany({ where: { userId: plan.userId } });
  const inventoryMap = {};
  for (const inv of inventory) {
    inventoryMap[inv.foodName.toLowerCase()] = inv.quantityG;
  }

  const totals = {};
  for (const meal of plan.meals) {
    if (!meal.recipe?.ingredients) continue;
    for (const ing of meal.recipe.ingredients) {
      const key = ing.ingredientName.toLowerCase();
      if (!totals[key]) {
        totals[key] = { ingredientName: ing.ingredientName, amountG: 0, category: guessCategory(ing.ingredientName) };
      }
      totals[key].amountG += ing.amountG;
    }
  }

  const items = Object.values(totals).map((item) => {
    const invQty = inventoryMap[item.ingredientName.toLowerCase()] || 0;
    const needed = Math.max(0, item.amountG - invQty);
    return {
      foodName: item.ingredientName,
      quantityG: needed,
      quantityDisplay: formatQuantity(item.ingredientName, needed),
      category: item.category,
      inInventory: invQty >= item.amountG,
      checked: false,
    };
  }).filter((item) => item.quantityG > 0);

  await prisma.weeklyShoppingList.deleteMany({ where: { planId } });
  if (items.length > 0) {
    const list = await prisma.weeklyShoppingList.create({ data: { planId } });
    await prisma.weeklyShoppingItem.createMany({
      data: items.map((item) => ({ shoppingListId: list.id, ...item })),
    });
  }

  return { itemsCount: items.length };
}

async function toggleChecked(shoppingItemId, checked) {
  const prisma = getPrisma();
  const item = await prisma.weeklyShoppingItem.findUnique({ where: { id: shoppingItemId } });
  if (!item) throw new Error('Item not found.');
  return prisma.weeklyShoppingItem.update({
    where: { id: shoppingItemId },
    data: { checked: !!checked, checkedAt: checked ? new Date() : null },
  });
}

async function getShoppingList(planId) {
  const prisma = getPrisma();
  const list = await prisma.weeklyShoppingList.findUnique({
    where: { planId },
    include: { items: true },
  });
  if (!list) return { items: [] };
  return {
    items: list.items.sort((a, b) => {
      if (a.checked === b.checked) return a.foodName.localeCompare(b.foodName);
      return a.checked ? 1 : -1;
    }),
  };
}

module.exports = { generateIngredientShoppingList, toggleChecked, getShoppingList };
