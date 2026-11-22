jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: jest.fn(() => false) }));
const { NUTRIENTS, BY_KEY } = require('../src/services/nutrientCatalog');
const { nutrientStatus, snapshotNutrients } = require('../src/services/nutrientStatus');
const { suggestMeals } = require('../src/services/nutritionRecommendation');

const prismaOf = logs => ({ foodLog: { findMany: async () => logs } });

describe('nutrient catalog', () => {
  it('has unique keys, canonical units, and no invented targets', () => {
    const keys = NUTRIENTS.map(n => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of NUTRIENTS) { expect(n.unit).toMatch(/^(g|mg|mcg|kcal)$/); expect(n.category).toBeTruthy(); }
    expect(BY_KEY.sugarG.referenceIntake).toBeNull(); // no fabricated daily target
    expect(BY_KEY.sodiumMg.referenceIntake).toBe(2300);
  });
});

describe('nutrientStatus', () => {
  const base = { calories: 500, proteinG: 20, carbsG: 60, fatG: 15, loggedAt: new Date() };
  it('aggregates native fields and reports partial coverage for missing values', async () => {
    const prisma = prismaOf([{ ...base, fiberG: 5 }, { ...base, fiberG: null }]);
    const s = await nutrientStatus(prisma, 'u1', { days: 1 });
    expect(s.nutrients.proteinG.value).toBe(40);
    expect(s.nutrients.fiberG.value).toBe(5);
    expect(s.nutrients.fiberG.coverage).toBe('partial');
    expect(s.nutrients.fiberG.logsMissingValue).toBe(1);
    expect(s.nutrients.sodiumMg.coverage).toBe('none');
  });
  it('reads whitelisted nutrients from nutritionSnapshot', async () => {
    const prisma = prismaOf([{ ...base, fiberG: 2, nutritionSnapshot: { sodiumMg: 400, sugarG: 8, bogus: 99 } }]);
    const s = await nutrientStatus(prisma, 'u1', { days: 1 });
    expect(s.nutrients.sodiumMg.value).toBe(400);
    expect(s.nutrients.sugarG.value).toBe(8);
    expect(s.nutrients).not.toHaveProperty('bogus');
  });
  it('prefers the persistent micronutrients column over the snapshot', async () => {
    const prisma = prismaOf([{ ...base, fiberG: 2, micronutrients: { sodiumMg: 500 }, nutritionSnapshot: { sodiumMg: 400 } }]);
    const s = await nutrientStatus(prisma, 'u1', { days: 1 });
    expect(s.nutrients.sodiumMg.value).toBe(500);
  });
  it('never returns zero for an empty day', async () => {
    const s = await nutrientStatus(prismaOf([]), 'u1', { days: 7 });
    expect(s.nutrients.proteinG.coverage).toBe('no-data');
    expect(s.daysWithData).toBe(0);
  });
});

describe('suggestMeals', () => {
  const recipe = (over) => ({
    id: over.id || 'r1', recipeName: over.name || 'Dal', cuisine: 'Indian', aliases: [], allergens: [],
    servings: 1, calories: 400, proteinG: 18, carbsG: 50, fatG: 8, fiberG: 9,
    reviewStatus: 'UNREVIEWED_RESEARCH_DRAFT', prepMinutes: 30,
    ingredients: [{ ingredientName: 'lentils', amountG: 100, optional: false }], ...over,
  });
  function prismaWith({ logs = [], allergies = [], conditions = [], recipes = [] }) {
    return {
      foodLog: { findMany: async () => logs },
      userAllergy: { findMany: async () => allergies },
      userHealthCondition: { findMany: async () => conditions },
      recipe: { findMany: async () => recipes },
    };
  }
  it('excludes allergen matches and never recommends rejected recipes', async () => {
    const prisma = prismaWith({
      allergies: [{ allergy: { name: 'peanut' } }],
      recipes: [recipe({ id: 'bad', name: 'Peanut chutney', ingredients: [{ ingredientName: 'peanuts', amountG: 20, optional: false }] }), recipe({ id: 'ok' }), recipe({ id: 'rej', reviewStatus: 'REJECTED' })],
    });
    const out = await suggestMeals(prisma, 'u1');
    const ids = out.items.map(i => i.recipeId);
    expect(ids).toEqual(['ok']);
    expect(out.rejectedCount).toBe(1);
  });
  it('ranks gap-covering protein higher and labels draft nutrition as estimated', async () => {
    const prisma = prismaWith({
      logs: [{ calories: 1200, proteinG: 10, carbsG: 100, fatG: 30, fiberG: 2, loggedAt: new Date() }],
      recipes: [recipe({ id: 'low', proteinG: 4 }), recipe({ id: 'high', proteinG: 35 })],
    });
    const out = await suggestMeals(prisma, 'u1');
    expect(out.items[0].recipeId).toBe('high');
    expect(out.items[0].completeness).toBe('ESTIMATE_WITH_ASSUMPTIONS');
    expect(out.items[0].why[0]).toMatch(/protein/);
    expect(out.aiPersonalized).toBe(false);
  });
  it('applies only APPROVED condition rules to block ingredients', async () => {
    const prisma = prismaWith({
      conditions: [{ conditionId: 'c1', condition: { conditionRules: [
        { id: 'r1', ruleCode: 'X', attribute: 'lentils', action: 'block', clinicalAction: 'BLOCK', clinicalSeverity: 'HIGH', reason: 'test' },
      ] } }],
      recipes: [recipe({ id: 'blocked' }), recipe({ id: 'free', name: 'Rice', ingredients: [{ ingredientName: 'rice', amountG: 100, optional: false }] })],
    });
    const out = await suggestMeals(prisma, 'u1');
    expect(out.items.map(i => i.recipeId)).toEqual(['free']);
  });
});
