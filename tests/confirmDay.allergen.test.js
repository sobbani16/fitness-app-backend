// confirmDay allergen regression (P0/HF-0001): locking a day re-verifies meals
// against CURRENT allergies. Fail-closed: conflict OR unknown composition blocks.
jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const { confirmDay } = require('../src/services/weekly/confirmationService');

const PLAN = { id: 'plan-1', userId: 'user-1' };

function world({ allergies = [], meals = [] } = {}) {
  const updateMany = jest.fn(async () => ({}));
  getPrisma.mockReturnValue({
    weeklyNutritionPlan: { findUnique: async () => PLAN },
    weeklyMeal: {
      updateMany,
      findMany: async (args) =>
        args.select ? meals.map(() => ({ confirmedByUser: true })) : meals, // getDayState(select) vs guard(include)
    },
    userAllergy: {
      findMany: async () => allergies.map((name) => ({ allergy: { name } })),
    },
    ingredient: { findMany: async () => [] },
  });
  return { updateMany };
}

const recipeMeal = (over = {}) => ({
  mealType: 'lunch', foodName: 'X',
  recipe: { recipeName: 'X', allergens: [], nutritionSource: {}, ingredients: [], ...over.recipe },
  ...over,
});

describe('confirmDay — allergen fail-closed regression', () => {
  test('peanut-allergic user cannot lock a peanut meal — nothing is written', async () => {
    const { updateMany } = world({
      allergies: ['peanut'],
      meals: [recipeMeal({ foodName: 'Peanut Curry', recipe: { recipeName: 'Peanut Curry', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'peanuts', ingredientId: null }] } })],
    });
    await expect(confirmDay('plan-1', 1, 'user-1')).rejects.toMatchObject({ status: 409, code: 'ALLERGEN_CONFLICT' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('composite ingredient without declared allergens → unknown → blocked (fail closed)', async () => {
    const { updateMany } = world({
      allergies: ['milk'],
      meals: [recipeMeal({ recipe: { recipeName: 'Veggie Wrap', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'tortilla wrap', ingredientId: null }] } })],
    });
    await expect(confirmDay('plan-1', 1, 'user-1')).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('ad-hoc meal with no recipe → no ingredient list → blocked for allergic users', async () => {
    const { updateMany } = world({ allergies: ['egg'], meals: [{ mealType: 'lunch', foodName: 'Random Bistro Soup', recipe: null }] });
    await expect(confirmDay('plan-1', 1, 'user-1')).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('identical peanut meal confirms fine for a user with NO allergies', async () => {
    const { updateMany } = world({
      allergies: [],
      meals: [recipeMeal({ foodName: 'Peanut Curry', recipe: { recipeName: 'Peanut Curry', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'peanuts' }] } })],
    });
    const res = await confirmDay('plan-1', 1, 'user-1');
    expect(res.confirmed).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  test('allergic user with verifiably clear simple meals confirms', async () => {
    const { updateMany } = world({
      allergies: ['shellfish'],
      meals: [recipeMeal({ foodName: 'rice', recipe: { recipeName: 'rice', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'water' }] } })],
    });
    // water is TRIVIAL — clear assessment
    const res = await confirmDay('plan-1', 1, 'user-1');
    expect(res.confirmed).toBe(true);
    expect(updateMany).toHaveBeenCalled();
  });

  test('allergy added AFTER plan generation blocks confirmation of pre-existing meals', async () => {
    // regression scenario: plan was generated before the allergy existed
    const { updateMany } = world({
      allergies: ['tree nuts'], // newly added allergy
      meals: [recipeMeal({ recipe: { recipeName: 'Almond Smoothie', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'almonds' }] } })],
    });
    await expect(confirmDay('plan-1', 1, 'user-1')).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  test('adversarial: custom allergen with regex metacharacters is literal-matched, no crash', async () => {
    const { updateMany } = world({
      allergies: ['peanut'],
      meals: [recipeMeal({ recipe: { recipeName: 'Plain rice', allergens: [], nutritionSource: {}, ingredients: [{ ingredientName: 'water' }] } })],
    });
    // custom allergy entries flow through user.custom — confirm the path doesn't throw on weird input
    getPrisma.mockReturnValue({
      ...getPrisma(),
      userAllergy: { findMany: async () => [{ allergy: { name: 'c++ oil.*' } }] },
    });
    await expect(confirmDay('plan-1', 1, 'user-1')).resolves.toBeDefined();
  });

  test('non-owner cannot confirm regardless of allergen state', async () => {
    world({ allergies: [], meals: [] });
    await expect(confirmDay('plan-1', 1, 'intruder')).rejects.toThrow(/not authorized/i);
  });

  test('declared recipe allergens count even when ingredient names hide them', async () => {
    const { updateMany } = world({
      allergies: ['sesame'],
      meals: [recipeMeal({ recipe: { recipeName: 'Mystery Loaf', allergens: ['sesame'], nutritionSource: {}, ingredients: [{ ingredientName: 'water' }] } })],
    });
    await expect(confirmDay('plan-1', 1, 'user-1')).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
