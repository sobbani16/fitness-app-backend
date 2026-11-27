// confirmDay allergy enforcement (HUM-34 §5): direct API-bypass tests.
// unknown composition ≠ allergen-safe · conflicts never overridable ·
// cross-user isolation · allergy profile drives the gate (not client claims).
const mockStore = { plan: null, meals: [], allergyNames: [], ingredients: new Map() };
const mockUpdateMany = jest.fn(async ({ where, data }) => {
  // Behave like the real update: flip confirmedByUser on the targeted meals.
  for (const m of mockStore.meals) if (m.planId === where.planId && m.dayOfWeek === where.dayOfWeek) m.confirmedByUser = data.confirmedByUser;
  return { count: mockStore.meals.length };
});
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    weeklyNutritionPlan: { findUnique: async () => mockStore.plan },
    weeklyMeal: {
      findMany: async () => mockStore.meals,
      updateMany: mockUpdateMany,
    },
    userAllergy: { findMany: async () => mockStore.allergyNames.map((name) => ({ allergy: { name } })) },
    ingredient: { findMany: async ({ where }) => [...mockStore.ingredients.values()].filter((i) => where.id.in.includes(i.id)) },
  }),
}));

const { confirmDay } = require('../src/services/weekly/confirmationService');

const USER = 'owner-1';
const plan = { id: 'p1', userId: USER, generationDetails: {} };
const meal = (over) => ({ id: 'm1', planId: 'p1', dayOfWeek: 1, mealType: 'lunch', foodName: 'Meal', confirmedByUser: false, recipe: null, ingredientId: null, ...over });
const recipe = (over) => ({ id: 'r1', recipeName: 'Dish', allergens: [], nutritionSource: null, ingredients: [], ...over });

beforeEach(() => {
  mockStore.plan = { ...plan }; mockStore.meals = [meal()]; mockStore.allergyNames = ['Peanuts'];
  mockStore.ingredients = new Map(); mockUpdateMany.mockClear();
});

it('blocks confirmed allergen conflicts — no writes happen', async () => {
  mockStore.meals = [meal({ foodName: 'Peanut noodles', recipe: recipe({ recipeName: 'Peanut noodles' }) })];
  await expect(confirmDay('p1', 1, USER)).rejects.toMatchObject({ status: 409, code: 'ALLERGY_CONFLICT' });
  expect(mockUpdateMany).not.toHaveBeenCalled();
});

it('treats unknown composition as unsafe — no ack, no confirm', async () => {
  // Bare foodName, no recipe, no AI provenance → composition unknown.
  await expect(confirmDay('p1', 1, USER)).rejects.toMatchObject({ status: 409, code: 'ALLERGY_COMPOSITION_UNKNOWN' });
  expect(mockUpdateMany).not.toHaveBeenCalled();
});

it('ack flag confirms unknown-composition days but never overrides conflicts', async () => {
  await expect(confirmDay('p1', 1, USER, { acknowledgeUnknownAllergens: true })).resolves.toMatchObject({ allConfirmed: true });
  expect(mockUpdateMany).toHaveBeenCalledTimes(1);

  mockUpdateMany.mockClear();
  mockStore.meals = [meal({ foodName: 'Peanut satay' })];
  await expect(confirmDay('p1', 1, USER, { acknowledgeUnknownAllergens: true })).rejects.toMatchObject({ code: 'ALLERGY_CONFLICT' });
  expect(mockUpdateMany).not.toHaveBeenCalled();
});

it('confirms a fully-resolved clear recipe', async () => {
  mockStore.ingredients = new Map([['ing-1', { id: 'ing-1', name: 'Brown Rice', catalog: { sourceRecord: { allergens: '[]' }, foodType: 'grain' } }]]);
  mockStore.meals = [meal({ recipe: recipe({ ingredients: [{ ingredientId: 'ing-1', ingredientName: 'Brown Rice' }] }) })];
  await expect(confirmDay('p1', 1, USER)).resolves.toMatchObject({ allConfirmed: true });
});

it('skips the gate entirely when the user records no allergies', async () => {
  mockStore.allergyNames = [];
  await expect(confirmDay('p1', 1, USER)).resolves.toMatchObject({ allConfirmed: true });
  expect(mockUpdateMany).toHaveBeenCalledTimes(1);
});

it('rejects confirming another user\u2019s plan', async () => {
  await expect(confirmDay('p1', 1, 'intruder')).rejects.toThrow(/Not authorized/);
  expect(mockUpdateMany).not.toHaveBeenCalled();
});
