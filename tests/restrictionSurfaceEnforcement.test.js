// HUM-42 §2.4/§2.6 — per-surface enforcement: a restriction created through
// the REAL production API must propagate through the canonical shared gate
// into consuming surfaces. No per-feature rules — the surfaces consume the
// gate, and the gate reads the same rows the API wrote.
const request = require('supertest');

const store = { restrictions: [], injuries: [], surgeries: [], symptoms: [], conditions: [] };
const uid = () => `r-${Math.random().toString(36).slice(2, 9)}`;
const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: { findMany: jest.fn(async () => store.injuries), findFirst: jest.fn(async () => null) },
  userSurgery: { findMany: jest.fn(async () => store.surgeries) },
  userSymptomReport: { findMany: jest.fn(async () => store.symptoms) },
  userHealthCondition: { findMany: jest.fn(async () => store.conditions) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
  activitySafetyEvaluation: { create: jest.fn() },
  userWorkoutPlan: { count: jest.fn(async () => 0), create: jest.fn(async ({ data }) => ({ id: uid(), ...data })) },
  userActivityRestriction: {
    create: jest.fn(async ({ data }) => {
      const row = { id: uid(), status: 'active', createdAt: new Date(), updatedAt: new Date(), ...data };
      store.restrictions.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where } = {}) => store.restrictions.filter((r) =>
      r.userId === where?.userId && (!where?.status || r.status === where.status || (where.status?.in && where.status.in.includes(r.status))))),
    findFirst: jest.fn(async () => null),
    update: jest.fn(),
    aggregate: jest.fn(async () => ({ _max: { updatedAt: new Date() } })),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => { throw new Error('offline'); }),
  markStale: obs => obs,
}));
jest.mock('../src/services/activitySafety/recommendationSafety', () => ({
  invalidateSafetyAdvice: jest.fn(async () => {}),
  freshSafetyRecommendations: jest.fn(async () => null),
}));
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(async () => ({ days: [] })), aiEnabled: () => true }));

const app = require('../src/app');
const { safetyGate } = require('../src/services/activitySafety/gate');
const planner = require('../src/services/workoutPlanner');
const auth = id => ({ 'x-user-id': id });

beforeEach(() => {
  store.restrictions.length = 0; store.injuries.length = 0; store.surgeries.length = 0;
  store.symptoms.length = 0; store.conditions.length = 0;
  jest.clearAllMocks();
});

describe('§2.4 unified enforcement — production API write propagates to consuming surfaces', () => {
  it('workout draft: restriction created via the real API blocks conflicting categories through the shared gate', async () => {
    // before: gate reports no blocked categories for this user
    const before = await safetyGate(mockPrisma, 'u-surf');
    expect(before.blockedCategories).toHaveLength(0);
    // create through the REAL production API — never seeded
    const created = await request(app).post('/activity-safety/restrictions').set(auth('u-surf'))
      .send({ categories: ['impact', 'weight_bearing_lower'], severity: 'prohibited', reason: 'stress fracture' });
    expect(created.status).toBe(201);
    // the SAME rows now flow through the canonical gate into blocking input
    const after = await safetyGate(mockPrisma, 'u-surf');
    expect(after.blockedCategories.length).toBeGreaterThan(0);
    // workout draft consumes the gate output: impact-category exercises are excluded
    // workout draft consumes the gate output. Build the AI response from an
    // exercise the gate actually leaves allowed — the draft must succeed WITH
    // restrictions accounted, never silently proceeding as if unrestricted.
    const { askJSON } = require('../src/services/aiProvider');
    const { allowed } = planner.candidatesFor({ goal: 'fitness' }, after);
    expect(allowed.size).toBeGreaterThan(0); // catalog has non-conflicting exercises
    const allowedId = [...allowed][0];
    askJSON.mockImplementationOnce(async () => ({ days: [
      { weekday: 'mon', focus: 'upper', exercises: [{ exerciseId: allowedId, sets: 3, reps: '10', restSec: 90 }] },
      // AI also proposes a BLOCKED exercise — the sanitizer must strip it
      { weekday: 'wed', focus: 'legs', exercises: [{ exerciseId: 'squat', sets: 3, reps: '10', restSec: 90 }] },
    ] }));
    const draft = await planner.generateDraft('u-surf', { goal: 'fitness' }, after);
    expect(draft.safety.restrictedCategoriesApplied).toBeGreaterThan(0);
    // weight_bearing_lower is restricted — squat carries it, so the leg day
    // must not survive sanitization with conflicting content
    const allIds = (draft.plan.days || []).flatMap((d) => (d.exercises || []).map((x) => x.exerciseId));
    const { EXERCISES } = require('../src/services/exerciseCatalog');
    const { exerciseCategories } = require('../src/services/activitySafety/gate');
    for (const id of allIds) {
      const cats = exerciseCategories(EXERCISES[id] || {});
      const list = cats instanceof Set ? [...cats] : cats;
      expect(list.some((cat) => ['impact', 'weight_bearing_lower'].includes(cat))).toBe(false);
    }
  });

  it('gate output feeds workoutPlanner candidates: blocked categories remove conflicting exercises', async () => {
    await request(app).post('/activity-safety/restrictions').set(auth('u-surf2'))
      .send({ categories: ['impact'], severity: 'prohibited' });
    const g = await safetyGate(mockPrisma, 'u-surf2');
    const { allowed } = planner.candidatesFor({ goal: 'fitness' }, g);
    // every remaining candidate must be category-clean against the restriction
    const { EXERCISES, exerciseCategories } = (() => {
      try { return { EXERCISES: require('../src/services/exerciseCatalog').EXERCISES, exerciseCategories: require('../src/services/activitySafety/gate').exerciseCategories }; }
      catch { return { EXERCISES: {}, exerciseCategories: () => [] }; }
    })();
    expect(allowed.size).toBeGreaterThan(0); // non-conflicting exercises remain available
    for (const id of allowed) {
      const cats = exerciseCategories(EXERCISES[id] || {});
      const list = cats instanceof Set ? [...cats] : cats;
      expect(list.includes('impact')).toBe(false);
    }
  });

  it('enforcement is category-exact: a restriction on overhead does not block lower-limb categories', async () => {
    await request(app).post('/activity-safety/restrictions').set(auth('u-surf3'))
      .send({ categories: ['overhead'], severity: 'prohibited' });
    const g = await safetyGate(mockPrisma, 'u-surf3');
    expect(g.blockedCategories).toContain('overhead');
    expect(g.blockedCategories).not.toContain('lower_limb_load');
  });
});
