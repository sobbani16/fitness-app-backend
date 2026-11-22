// v1 (healthScoreEngine) vs v2 (scoringV2) behavioral comparison.
// Not numeric equivalence — engines differ by design. Asserts each engine's
// contract on identical synthetic days and documents divergences for the
// HEALTH_SCORE_V1_V2_COMPARISON.md matrix.
const { dailyScore } = require('../src/services/scoringV2');

const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ timeZone: 'UTC' })) },
  macroGoal: { findUnique: jest.fn(async () => ({ proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000, caloriesTarget: 2200 })) },
  foodLog: { findMany: jest.fn(async () => []) },
  supplementLog: { findMany: jest.fn(async () => []) },
  waterLog: { findMany: jest.fn(async () => []) },
  workoutSession: { findMany: jest.fn(async () => []) },
  dailySteps: { findFirst: jest.fn(async () => null) },
  sleepLog: { findMany: jest.fn(async () => []) },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  ingredient: { findMany: jest.fn(async () => []) },
  healthScore: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: 'hs', ...data })), update: jest.fn(), delete: jest.fn() },
  scoreContributor: { createMany: jest.fn(), deleteMany: jest.fn() },
  healthScoreInsight: { createMany: jest.fn(), deleteMany: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const { calculateHealthScore } = require('../src/services/healthScoreEngine');

const T = { proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30, caloriesMin: 1760, caloriesMax: 2640, calorieFloor: null };
const V2 = (o = {}) => dailyScore({
  nutrition: { proteinG: null, carbsG: null, fatG: null, fiberG: null, calories: null, targets: T },
  foodQuality: {}, activity: {}, sleep: {}, hydration: {},
  ...o,
});
const V1 = (over = {}) => { for (const k of Object.keys(over)) mockPrisma[k].findMany.mockResolvedValue(over[k]); return calculateHealthScore('u', '2026-11-21'); };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000, caloriesTarget: 2200 });
  mockPrisma.foodLog.findMany.mockResolvedValue([]);
  mockPrisma.supplementLog.findMany.mockResolvedValue([]);
  mockPrisma.waterLog.findMany.mockResolvedValue([]);
  mockPrisma.workoutSession.findMany.mockResolvedValue([]);
  mockPrisma.sleepLog.findMany.mockResolvedValue([]);
  mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
  mockPrisma.ingredient.findMany.mockResolvedValue([]);
});

test('excess calories: v1 no kcal component (macro-only); v2 range-decays', async () => {
  const v1 = await V1({ foodLog: [{ foodName: 'Big meal', proteinG: 150, carbsG: 400, fatG: 120, fiberG: 40, calories: 3500 }] });
  expect(v1.components.macro.score).toBeGreaterThan(0); // macro adherence only
  const v2 = V2({ nutrition: { proteinG: 150, carbsG: 400, fatG: 120, fiberG: 40, calories: 3500, targets: T } });
  expect(v2.components.nutrition.energy.state).toBe('partial_data');
  expect(v2.components.nutrition.energy.reason).toContain('Above range');
});

test('severe underconsumption: neither fabricates success; v2 floor-gate ready (G4 inactive)', async () => {
  const v1 = await V1({ foodLog: [{ foodName: 'Crackers', proteinG: 2, carbsG: 15, fatG: 1, fiberG: 0, calories: 80 }] });
  expect(v1.components.macro.score).toBeLessThan(50);
  const v2 = V2({ nutrition: { proteinG: 2, carbsG: 15, fatG: 1, fiberG: 0, calories: 80, targets: { ...T, calorieFloor: 1400 } } });
  expect(v2.components.nutrition.energy.state).toBe('safety_suspended'); // policy still inactive — module only
});

test('missing meals (no logs): both abstain, never zero-as-failure', async () => {
  const v1 = await V1({});
  expect(v1.score).toBeNull();
  expect(v1.status).toBe('insufficient_data');
  const v2 = V2();
  expect(v2.state).toBe('no_data');
  // composite is points-earned, not a data-availability signal: only
  // safety_suspended yields null. Consumers MUST gate on `state` — a raw
  // composite of 0 means "no data", not "zero performance". Documented
  // consumer-education finding in HEALTH_SCORE_V1_V2_COMPARISON.md.
  expect(v2.composite).toBe(0);
});

test('incomplete nutrient coverage: v1 column-sum ignores gaps; v2 marks no_data', async () => {
  const v1 = await V1({ foodLog: [{ foodName: 'A', proteinG: 50, carbsG: 60, fatG: 20, fiberG: 0, calories: 600 }] });
  expect(v1.components.macro.available).toBe(true); // fiber=0 treated as real zero
  const v2 = V2({ nutrition: { proteinG: 50, carbsG: 60, fatG: 20, fiberG: null, calories: 600, targets: T } });
  expect(v2.components.nutrition.parts.fiber.state).toBe('no_data'); // unknown stays unknown
});

test('excess macros: v1 penalizes >130% carbs/fat via contributors; v2 adequacy caps silently', async () => {
  const v1 = await V1({ foodLog: [{ foodName: 'X', proteinG: 150, carbsG: 400, fatG: 100, fiberG: 40, calories: 3000 }] });
  expect(v1.allContributors.some((c) => c.itemName === 'Carb Excess' && c.scoreImpact < 0)).toBe(true);
  const v2 = V2({ nutrition: { proteinG: 150, carbsG: 400, fatG: 100, fiberG: 40, calories: 3000, targets: T } });
  expect(v2.components.nutrition.parts.carbs.points).toBeLessThanOrEqual(6); // range-scored since v2.1 (HF-0020): mild decay above band, no explicit penalty
});

test('missing activity data: both report unavailable/no_data, not failure', async () => {
  const v1 = await V1({});
  expect(v1.components.activity.available).toBe(false);
  const v2 = V2();
  expect(v2.components.activity.parts.movement.state).toBe('no_data');
});

test('duplicate workouts: v1 sums minutes (double-counts); v2 counts sessions (pattern)', async () => {
  const v1 = await V1({ workoutSession: [{ durationMinutes: 45 }, { durationMinutes: 45 }] });
  expect(v1.components.activity.score).toBe(100); // 90 min
  const v2 = V2({ activity: { weeklyMovementMin: 90, cardioSessions: 2, resistanceSessions: 0 } });
  expect(v2.components.activity.earned).toBeGreaterThan(0);
});

test('timezone: v1 windows by user TZ (Kiritimati UTC+14); v2 caller supplies instants', async () => {
  mockPrisma.user.findUnique.mockResolvedValue({ timeZone: 'Pacific/Kiritimati' });
  await V1({});
  const call = mockPrisma.foodLog.findMany.mock.calls[0][0];
  expect(call.where.loggedAt.gte.toISOString()).toBe('2026-11-20T10:00:00.000Z'); // local midnight ≠ UTC midnight
});

test('historical snapshots: v1 persists HealthScore rows on every call; v2 snapshots are versioned upserts by the route', async () => {
  await V1({ foodLog: [{ foodName: 'A', proteinG: 30, carbsG: 40, fatG: 10, fiberG: 5, calories: 400 }] });
  expect(mockPrisma.healthScore.create).toHaveBeenCalled(); // GET mutates — documented
  // v2 pure function writes nothing; snapshot persistence lives in the route.
});

test('goal changes: both read MacroGoal per call (no cached targets)', async () => {
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ proteinTarget: 60, carbsTarget: 200, fatTarget: 50, fiberTarget: 25, waterMlTarget: 2000 });
  const v1 = await V1({ foodLog: [{ foodName: 'A', proteinG: 65, carbsG: 200, fatG: 50, fiberG: 25, calories: 1500 }] });
  expect(v1.components.macro.score).toBeGreaterThan(80); // met 60g goal
});

test('unapproved clinical rules: inert in v1 now (query gate); absent from v2 input contract entirely', async () => {
  // v1: the prisma query filters reviewStatus='APPROVED' at DB level — mocked
  // rows can't demonstrate the gate, but the WHERE clause is asserted.
  mockPrisma.userHealthCondition.findMany.mockResolvedValue([{ condition: { name: 'X', conditionRules: [] } }]);
  await V1({});
  const q = mockPrisma.userHealthCondition.findMany.mock.calls[0][0];
  expect(q.include.condition.include.conditionRules.where.reviewStatus).toBe('APPROVED');
});
