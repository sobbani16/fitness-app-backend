// Shadow-mode diff job — unreviewed (DRAFT) rules may only ever influence the
// shadow evaluation, never the live/user-facing decision.
const mockPrisma = {};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const mockFlags = { isEnabled: jest.fn() };
jest.mock('../src/services/featureFlags/service', () => mockFlags);

const { shadowForUser } = require('../scripts/activity-safety-shadow-diff');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();

const NOW = new Date();
const ALL_CATEGORIES_BLOCK = { // DRAFT rule that would block strength training
  ruleCode: 'AS-TEST-001', name: 'test draft', reviewStatus: 'DRAFT',
  appliesTo: { activityCategories: ['valsalva'] }, effect: 'BLOCK_ACTIVITY', reason: 'test',
};
const MODIFY_RULE = {
  ruleCode: 'AS-TEST-002', name: 'test draft 2', reviewStatus: 'DRAFT',
  appliesTo: { activityCategories: ['weight_bearing_lower'] }, effect: 'MODIFY', reason: 'test2',
};

function ctxModels({ draftRules = [], approvedRules = [] } = {}) {
  return {
    user: { findUnique: jest.fn(async () => ({ dateOfBirth: null, activityLevel: 'moderate', goalType: 'fitness', timeZone: 'UTC', waterGoalMl: null })) },
    userActivityProfile: { findUnique: jest.fn(async () => null) },
    userInjury: { findMany: jest.fn(async () => []) },
    userSurgery: { findMany: jest.fn(async () => []) },
    userActivityRestriction: { findMany: jest.fn(async () => []) },
    userSymptomReport: { findMany: jest.fn(async () => []) },
    userHealthCondition: { findMany: jest.fn(async () => []) },
    activitySafetyRule: {
      findMany: jest.fn(async ({ where } = {}) => (where?.reviewStatus === 'APPROVED' ? approvedRules : [...approvedRules, ...draftRules])),
    },
    activitySafetyEvaluation: { create: jest.fn(async ({ data }) => ({ id: 'ev1', ...data })) },
  };
}

beforeEach(() => { for (const k of Object.keys(mockPrisma)) delete mockPrisma[k]; jest.clearAllMocks(); });

test('flag off → skipped, no rules loaded, nothing persisted', async () => {
  Object.assign(mockPrisma, ctxModels({ draftRules: [ALL_CATEGORIES_BLOCK] }));
  mockFlags.isEnabled.mockResolvedValue(false);
  const r = await shadowForUser(prisma, 'u1');
  expect(r).toEqual({ userId: 'u1', skipped: 'flag_off' });
  expect(mockPrisma.activitySafetyRule.findMany).not.toHaveBeenCalled();
  expect(mockPrisma.activitySafetyEvaluation.create).not.toHaveBeenCalled();
});

test('flag on + draft rule flips strength_training decision → delta, live stays ALLOW', async () => {
  Object.assign(mockPrisma, ctxModels({ draftRules: [ALL_CATEGORIES_BLOCK] }));
  mockFlags.isEnabled.mockResolvedValue(true);
  const r = await shadowForUser(prisma, 'u1');
  const d = r.deltas.find(x => x.activityId === 'strength_training');
  expect(d).toBeTruthy();
  expect(d.live).toBe('ALLOW');
  expect(d.shadow).toBe('BLOCK_ACTIVITY');
  expect(d.draftRulesFired).toEqual(['AS-TEST-001']);
  expect(r.liveRulesCount).toBe(0);
  expect(r.shadowRulesCount).toBe(1);
});

test('same-decision draft annotations still surface as deltas (newRules)', async () => {
  Object.assign(mockPrisma, ctxModels({ draftRules: [MODIFY_RULE] }));
  mockFlags.isEnabled.mockResolvedValue(true);
  const r = await shadowForUser(prisma, 'u1');
  // indoor_walk has weight_bearing_lower → live ALLOW, shadow MODIFY
  const d = r.deltas.find(x => x.activityId === 'indoor_walk');
  expect(d.shadow).toBe('MODIFY');
  expect(d.draftRulesFired).toContain('AS-TEST-002');
});

test('persist=true writes only shadow-marked rows; never mutates live rows', async () => {
  Object.assign(mockPrisma, ctxModels({ draftRules: [ALL_CATEGORIES_BLOCK] }));
  mockFlags.isEnabled.mockResolvedValue(true);
  const r = await shadowForUser(prisma, 'u1', { persist: true });
  expect(r.persisted).toBeGreaterThan(0);
  for (const call of mockPrisma.activitySafetyEvaluation.create.mock.calls) {
    expect(call[0].data.shadow).toBe(true);
  }
});

test('no draft rules → zero deltas, still evaluates', async () => {
  Object.assign(mockPrisma, ctxModels());
  mockFlags.isEnabled.mockResolvedValue(true);
  const r = await shadowForUser(prisma, 'u1');
  expect(r.deltas).toEqual([]);
  expect(r.persisted).toBe(0);
});

test('privacy — delta objects carry only ids/decision/rule codes (no medical text)', async () => {
  Object.assign(mockPrisma, ctxModels({ draftRules: [ALL_CATEGORIES_BLOCK] }));
  mockFlags.isEnabled.mockResolvedValue(true);
  const r = await shadowForUser(prisma, 'u1');
  for (const d of r.deltas) {
    expect(Object.keys(d).sort()).toEqual(['activityId', 'draftRulesFired', 'live', 'shadow']);
    expect(JSON.stringify(d)).not.toMatch(/reason|symptom|injur|restriction|diagnos/i);
  }
});
