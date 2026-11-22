// Fiber grounding for chat + voice — every answer must come from the engine,
// ingredient catalog, or supplement-check education. No LLM, no fabrication.

const mockStore = { user: { id: 'u1', dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC' }, ingredients: [], foodLogs: [], macroGoal: null, conditions: [], allergies: [], foodPrefs: [], suppLogs: [], plans: [] };

jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: { findUnique: async () => mockStore.user },
    ingredient: {
      findMany: async ({ where, take } = {}) => {
        const term = (where?.name?.contains || '').toLowerCase();
        const rows = mockStore.ingredients.filter((i) => i.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name));
        return take ? rows.slice(0, take) : rows;
      },
    },
    foodLog: { findMany: async () => mockStore.foodLogs, findFirst: async () => mockStore.foodLogs[0] || null },
    macroGoal: { findUnique: async () => mockStore.macroGoal },
    userHealthCondition: { findMany: async () => mockStore.conditions },
    userAllergy: { findMany: async () => mockStore.allergies },
    foodPreference: { findMany: async () => mockStore.foodPrefs },
    supplementLog: { findMany: async () => mockStore.suppLogs },
    weeklyNutritionPlan: { findFirst: async () => mockStore.plans[0] || null },
    fiberDailyRecommendation: { upsert: async () => ({}) },
  }),
}));

const { groundFiberAnswer, isFiberQuestion } = require('../src/services/fiber/assistant');

beforeEach(() => {
  mockStore.ingredients = [
    { name: 'Chana dal split chickpea, dry', fiberPer100g: 17 },
    { name: 'Broccoli, raw', fiberPer100g: 2.6 },
    { name: 'Mystery flakes', fiberPer100g: null },
  ];
  mockStore.foodLogs = []; mockStore.macroGoal = { caloriesTarget: 2000, fiberTarget: 30 };
  mockStore.conditions = []; mockStore.allergies = []; mockStore.foodPrefs = []; mockStore.suppLogs = []; mockStore.plans = [];
});

describe('isFiberQuestion', () => {
  it.each([
    ['How much fiber have I eaten today?', true],
    ['Can I take isabgol?', true],
    ['What should I eat first?', true],
    ['psyllium husk dose?', true],
    ['What is the weather today?', false],
    ['Log my workout', false],
  ])('%s → %s', (q, want) => expect(isFiberQuestion(q)).toBe(want));
});

describe('groundFiberAnswer', () => {
  it('answers daily totals from the engine — never an LLM guess', async () => {
    mockStore.foodLogs = [{ id: 'l1', foodName: 'Dal + rice', mealType: 'lunch', fiberG: 8, nutritionSnapshot: null, loggedAt: new Date() }];
    const r = await groundFiberAnswer('u1', 'How much fiber have I eaten today?');
    expect(r.handled).toBe(true);
    expect(r.topic).toBe('daily_fiber');
    expect(r.answer).toMatch(/8 g/);
    expect(r.answer).toMatch(/28 g/); // 2000 kcal → 28 g formula target
  });
  it('reports unknown logs as unknown, not zero', async () => {
    mockStore.foodLogs = [{ id: 'l1', foodName: 'Mystery meal', mealType: 'lunch', fiberG: null, nutritionSnapshot: null, loggedAt: new Date() }];
    const r = await groundFiberAnswer('u1', 'how much fiber today');
    expect(r.answer).toMatch(/no fiber data|unknown/i);
    expect(r.answer).not.toMatch(/0 g of fiber/);
  });
  it('answers ingredient fiber verbatim per 100 g', async () => {
    const r = await groundFiberAnswer('u1', 'Does broccoli have fiber?');
    expect(r.answer).toMatch(/2.6 g.*per 100 g/);
    expect(r.answer).toMatch(/Broccoli/);
  });
  it('reports a dry-weight range when a phrase matches several dry entries — never a cooked-looking single number', async () => {
    mockStore.ingredients.push({ name: 'Toor/arhar dal, dry', fiberPer100g: 15 }, { name: 'Masoor dal red, dry', fiberPer100g: 10.7 });
    const r = await groundFiberAnswer('u1', 'Does dal contain enough fiber?');
    expect(r.answer).toMatch(/dry/i);
    expect(r.answer).toMatch(/10\.7–17 g fiber per 100 g/);
    expect(r.answer).not.toMatch(/^.{0,40}17 g of fiber per 100 g\./); // single dry figure must not be presented as the answer
  });
  it('says unknown when the ingredient has no fiber value', async () => {
    const r = await groundFiberAnswer('u1', 'Does mystery flakes have fiber?');
    expect(r.answer).toMatch(/isn’t recorded|unknown/i);
    expect(r.answer).not.toMatch(/0 g/);
  });
  it('declines unknown foods honestly', async () => {
    const r = await groundFiberAnswer('u1', 'Does qwertyfruit contain fiber?');
    expect(r.handled).toBe(true);
    expect(r.answer).toMatch(/couldn’t match/i);
  });
  it('gives food-first suggestions for a fiber gap', async () => {
    const r = await groundFiberAnswer('u1', 'I am short on fiber. What can I eat?');
    expect(r.topic).toBe('fiber_suggestions');
    expect(r.answer).not.toMatch(/psyllium|isabgol|supplement/i);
  });
  it('routes sequencing questions to the sequencing engine', async () => {
    const r = await groundFiberAnswer('u1', 'What should I eat first?');
    expect(r.topic).toBe('meal_sequence');
  });
  it('never emits a supplement dose — directs to the verified-label check', async () => {
    for (const q of ['Can I take isabgol?', 'How much fiber is in my psyllium product?', 'Is psyllium safe for me?']) {
      const r = await groundFiberAnswer('u1', q);
      expect(r.handled).toBe(true);
      expect(r.answer).not.toMatch(/take \d+\s*(g|gram|teaspoon|tsp|scoop|capsule)/i);
      expect(r.answer).toMatch(/label|Fiber/i);
    }
  });
  it('always carries the hydration rule in supplement answers', async () => {
    const r = await groundFiberAnswer('u1', 'Can I take isabgol?');
    expect(r.answer).toMatch(/240 mL|liquid/i);
    expect(r.answer).toMatch(/never swallow it dry|dry/i);
  });
  it('passes non-fiber questions through unhandled', async () => {
    const r = await groundFiberAnswer('u1', 'How do I improve my squat form?');
    expect(r.handled).toBe(false);
  });
});
