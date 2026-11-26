// HUM-49 Workstream H: macro score suppresses target-based advice on
// incomplete nutrient totals. Measured subtotals + assessment availability
// exposed per macro; tips neutral when any log is unknown for that macro.
const mockGoals = {
  userId: 'u1', caloriesTarget: 2200, proteinTarget: 150, carbsTarget: 250,
  fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000,
};
let mockLogs = [];
const mockDb = {
  macroGoal: {
    findUnique: jest.fn(async () => mockGoals),
    upsert: jest.fn(async () => mockGoals),
  },
  foodLog: { findMany: jest.fn(async () => mockLogs) },
  waterLog: { findMany: jest.fn(async () => []) },
  dailyMacroScore: { upsert: jest.fn(async () => ({})) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockDb }));
const { calculateScore } = require('../src/services/macroScoreService');

const log = (fields, unknowns) => ({
  calories: 500, proteinG: 30, carbsG: 60, fatG: 15, fiberG: 8, ...fields,
  ...(unknowns !== undefined ? { nutritionSnapshot: { nutrientUnknowns: unknowns } } : {}),
});
beforeEach(() => { mockLogs = []; });

describe('macro score coverage suppression', () => {
  it('mixed intake: measured subtotal exposed, tip replaced with neutral explanation for unknown macros', async () => {
    mockLogs = [log({ proteinG: 30 }), log({ proteinG: 0 }, ['proteinG'])]; // protein unknown in one log
    const r = await calculateScore('u1', '2026-11-10');
    expect(r.breakdown.protein.measuredSubtotal).toBe(30);
    expect(r.breakdown.protein.unknownLogs).toBe(1);
    expect(r.breakdown.protein.assessmentAvailable).toBe(false);
    expect(r.breakdown.protein.tip).toMatch(/data is incomplete/);
    expect(r.breakdown.protein.tip).not.toMatch(/more protein/);
    // fully-measured macros keep target-based tips
    expect(r.breakdown.carbs.assessmentAvailable).toBe(true);
    expect(r.breakdown.carbs.tip).not.toMatch(/data is incomplete/);
  });

  it('all-unknown intake for a macro: measured subtotal is null, no target advice', async () => {
    mockLogs = [log({ fiberG: 0 }, ['fiberG']), log({ fiberG: 0 }, ['fiberG'])];
    const r = await calculateScore('u1', '2026-11-10');
    expect(r.breakdown.fiber.measuredSubtotal).toBeNull();
    expect(r.breakdown.fiber.assessmentAvailable).toBe(false);
    expect(r.breakdown.fiber.tip).toMatch(/data is incomplete/);
  });

  it('measured zero remains zero — not reclassified unknown, tip preserved', async () => {
    mockLogs = [log({ fiberG: 0 }, [])]; // explicit no-unknowns: fiber measured at 0
    const r = await calculateScore('u1', '2026-11-10');
    expect(r.breakdown.fiber.measuredSubtotal).toBe(0);
    expect(r.breakdown.fiber.assessmentAvailable).toBe(true);
    expect(r.breakdown.fiber.tip).toMatch(/fiber target/); // target-based advice preserved
  });

  it('legacy snapshot-less logs count as measured — behavior unchanged', async () => {
    mockLogs = [log({ proteinG: 40 })]; // no nutritionSnapshot at all
    const r = await calculateScore('u1', '2026-11-10');
    expect(r.breakdown.protein.assessmentAvailable).toBe(true);
    expect(r.breakdown.protein.measuredSubtotal).toBe(40);
    expect(r.breakdown.protein.tip).not.toMatch(/data is incomplete/);
  });

  it('numeric fields, score formula, and cache contract preserved', async () => {
    mockLogs = [log({ proteinG: 0 }, ['proteinG'])];
    const r = await calculateScore('u1', '2026-11-10');
    expect(typeof r.overallScore).toBe('number');
    expect(r.breakdown.protein.actual).toBe(0); // raw sum unchanged even though unknown
    expect(r.nutrientCoverage).toBeDefined();
    expect(mockDb.dailyMacroScore.upsert).toHaveBeenCalled(); // cache contract intact
  });
});
