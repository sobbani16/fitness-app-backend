const { statusFromScore, WEIGHTS } = require('../src/services/healthScoreEngine');

const mockPrisma = {
  macroGoal: { findUnique: jest.fn() },
  foodLog: { findMany: jest.fn() },
  supplementLog: { findMany: jest.fn() },
  waterLog: { findMany: jest.fn() },
  workoutSession: { findMany: jest.fn() },
  dailySteps: { findFirst: jest.fn() },
  sleepLog: { findMany: jest.fn() },
  userHealthCondition: { findMany: jest.fn() },
  ingredient: { findMany: jest.fn() },
  healthScore: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  scoreContributor: { createMany: jest.fn(), deleteMany: jest.fn() },
  healthScoreInsight: { createMany: jest.fn(), deleteMany: jest.fn() },
  dailyMacroScore: { upsert: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const { calculateHealthScore, getImprovementActions } = require('../src/services/healthScoreEngine');

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.macroGoal.findUnique.mockResolvedValue({ proteinTarget: 150, carbsTarget: 250, fatTarget: 70, fiberTarget: 30, waterMlTarget: 2000 });
  mockPrisma.foodLog.findMany.mockResolvedValue([]);
  mockPrisma.supplementLog.findMany.mockResolvedValue([]);
  mockPrisma.waterLog.findMany.mockResolvedValue([]);
  mockPrisma.workoutSession.findMany.mockResolvedValue([]);
  mockPrisma.dailySteps.findFirst.mockResolvedValue(null);
  mockPrisma.sleepLog.findMany.mockResolvedValue([]);
  mockPrisma.userHealthCondition.findMany.mockResolvedValue([]);
  mockPrisma.ingredient.findMany.mockResolvedValue([]);
  mockPrisma.healthScore.findUnique.mockResolvedValue(null);
  mockPrisma.healthScore.create.mockImplementation(async ({ data }) => ({ id: 'hs-1', ...data }));
  mockPrisma.scoreContributor.createMany.mockResolvedValue({});
  mockPrisma.healthScoreInsight.createMany.mockResolvedValue({});
});

describe('Health Score Engine', () => {
  describe('statusFromScore', () => {
    it('elite for 90+', () => expect(statusFromScore(95)).toBe('elite'));
    it('excellent for 80-89', () => expect(statusFromScore(85)).toBe('excellent'));
    it('good for 70-79', () => expect(statusFromScore(75)).toBe('good'));
    it('fair for 60-69', () => expect(statusFromScore(65)).toBe('fair'));
    it('needs_attention below 60', () => expect(statusFromScore(45)).toBe('needs_attention'));
  });

  describe('calculateHealthScore', () => {
    it('returns a score with all components', async () => {
      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.components).toHaveProperty('macro');
      expect(result.components).toHaveProperty('condition');
      expect(result.components).toHaveProperty('foodQuality');
      expect(result.components).toHaveProperty('activity');
      expect(result.components).toHaveProperty('recovery');
      expect(result.status).toBeDefined();
    });

    it('protein achievement increases macro score', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { foodName: 'Chicken', proteinG: 60, carbsG: 80, fatG: 15, fiberG: 8, calories: 500 },
        { foodName: 'Eggs', proteinG: 50, carbsG: 85, fatG: 25, fiberG: 5, calories: 550 },
        { foodName: 'Yogurt', proteinG: 45, carbsG: 85, fatG: 25, fiberG: 17, calories: 500 },
      ]);
      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.components.macro.score).toBeGreaterThan(70);
      expect(result.topContributors.some((c) => c.itemName === 'Protein Goal' && c.scoreImpact > 0)).toBe(true);
    });

    it('protein deficit creates negative contributor', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { foodName: 'Salad', proteinG: 5, carbsG: 20, fatG: 2, fiberG: 8, calories: 100 },
      ]);
      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.allContributors.some((c) => c.itemName === 'Protein Goal' && c.scoreImpact < 0)).toBe(true);
      expect(result.insights.some((i) => i.message.includes('protein'))).toBe(true);
    });

    it('diabetic user eating high sugar food lowers condition score', async () => {
      mockPrisma.userHealthCondition.findMany.mockResolvedValue([{
        userId: 'user-1',
        active: true,
        condition: {
          name: 'Type 2 Diabetes',
          conditionRules: [{ attribute: 'HIGH_SUGAR', target: 'ingredient', action: 'block', reason: 'High sugar spikes blood glucose' }],
        },
      }]);
      mockPrisma.ingredient.findMany.mockResolvedValue([
        { name: 'Candy', attributes: [{ attribute: 'HIGH_SUGAR' }] },
      ]);
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { foodName: 'Candy', proteinG: 0, carbsG: 60, fatG: 5, fiberG: 0, calories: 250 },
      ]);

      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.components.condition.score).toBeLessThan(100);
      expect(result.allContributors.some((c) => c.itemName === 'Candy' && c.scoreImpact < 0)).toBe(true);
      expect(result.insights.some((i) => i.message.includes('Diabetes'))).toBe(true);
    });

    it('hypertension user eating high sodium lowers score', async () => {
      mockPrisma.userHealthCondition.findMany.mockResolvedValue([{
        userId: 'user-1',
        active: true,
        condition: {
          name: 'Hypertension',
          conditionRules: [{ attribute: 'HIGH_SODIUM', target: 'ingredient', action: 'block', reason: 'Excess sodium raises BP' }],
        },
      }]);
      mockPrisma.ingredient.findMany.mockResolvedValue([
        { name: 'Soy Sauce', attributes: [{ attribute: 'HIGH_SODIUM' }] },
      ]);
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { foodName: 'Soy Sauce', proteinG: 1, carbsG: 3, fatG: 0, fiberG: 0, calories: 10 },
      ]);

      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.components.condition.score).toBeLessThan(100);
      expect(result.allContributors.some((c) => c.category === 'condition' && c.scoreImpact < 0)).toBe(true);
    });

    it('fiber target achievement increases score', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { foodName: 'Oats', proteinG: 10, carbsG: 50, fatG: 5, fiberG: 15, calories: 300 },
        { foodName: 'Beans', proteinG: 12, carbsG: 30, fatG: 1, fiberG: 18, calories: 170 },
      ]);
      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.allContributors.some((c) => c.itemName === 'Fiber Goal' && c.scoreImpact > 0)).toBe(true);
    });

    it('workout completion improves activity score', async () => {
      mockPrisma.workoutSession.findMany.mockResolvedValue([
        { durationMinutes: 45 },
      ]);
      const result = await calculateHealthScore('user-1', '2026-06-13');
      expect(result.components.activity.score).toBe(100);
    });
  });

  describe('Improvement Actions', () => {
    it('suggests adding protein when below target', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { proteinG: 30, carbsG: 100, fatG: 20, fiberG: 5 },
      ]);
      mockPrisma.waterLog.findMany.mockResolvedValue([]);
      mockPrisma.workoutSession.findMany.mockResolvedValue([]);

      const { actions } = await getImprovementActions('user-1', '2026-06-13');
      expect(actions.some((a) => a.action.includes('protein'))).toBe(true);
      expect(actions[0].potentialGain).toBeGreaterThan(0);
    });

    it('suggests walking when no activity', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { proteinG: 150, carbsG: 250, fatG: 70, fiberG: 30 },
      ]);
      mockPrisma.waterLog.findMany.mockResolvedValue([{ amountMl: 2000 }]);
      mockPrisma.workoutSession.findMany.mockResolvedValue([]);

      const { actions } = await getImprovementActions('user-1', '2026-06-13');
      expect(actions.some((a) => a.action.includes('Walk'))).toBe(true);
    });

    it('actions sorted by potential gain', async () => {
      mockPrisma.foodLog.findMany.mockResolvedValue([
        { proteinG: 30, carbsG: 350, fatG: 20, fiberG: 5 },
      ]);
      mockPrisma.waterLog.findMany.mockResolvedValue([]);
      mockPrisma.workoutSession.findMany.mockResolvedValue([]);

      const { actions } = await getImprovementActions('user-1', '2026-06-13');
      for (let i = 1; i < actions.length; i++) {
        expect(actions[i - 1].potentialGain).toBeGreaterThanOrEqual(actions[i].potentialGain);
      }
    });
  });

  describe('Weights sum to 1', () => {
    it('all weights add up to 1.0', () => {
      const sum = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
      expect(sum).toBeCloseTo(1.0);
    });
  });
});
