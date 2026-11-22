// Phase 17 §6 — J12 persisted-advice invalidation + J15 send-time reevaluation.
const request = require('supertest');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');

const store = { recommendations: [], notifications: [], injuries: [], symptoms: [] };
const mockPrisma = {
  user: { findUnique: jest.fn(async () => ({ dateOfBirth: new Date('1990-01-01'), activityLevel: 'moderate', goalType: 'fitness' })) },
  userActivityProfile: { findUnique: jest.fn(async () => null) },
  userInjury: {
    findMany: jest.fn(async ({ where } = {}) => store.injuries.filter(i => !where || i.userId === where.userId)),
    create: jest.fn(async ({ data }) => { const r = { id: 'inj-' + store.injuries.length, ...data }; store.injuries.push(r); return r; }),
    deleteMany: jest.fn(async () => ({ count: 1 })),
    updateMany: jest.fn(async () => ({ count: 1 })),
    aggregate: jest.fn(async () => ({ _max: { updatedAt: new Date() } })),
  },
  userSurgery: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _max: { updatedAt: null } })) },
  userActivityRestriction: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _max: { updatedAt: null } })) },
  userSymptomReport: {
    findMany: jest.fn(async () => store.symptoms),
    create: jest.fn(async ({ data }) => { const r = { id: 'sym-' + store.symptoms.length, ...data }; store.symptoms.push(r); return r; }),
    aggregate: jest.fn(async () => ({ _max: { createdAt: new Date() } })),
  },
  userHealthCondition: { findMany: jest.fn(async () => []) },
  activitySafetyRule: { findMany: jest.fn(async () => []) },
  activitySafetyEvaluation: { create: jest.fn(async ({ data }) => ({ id: 'ev-1', ...data })) },
  activitySafetyFeedback: { create: jest.fn(async ({ data }) => ({ id: 'fb-1', ...data })) },
  recommendation: {
    updateMany: jest.fn(async ({ where, data }) => {
      let n = 0;
      for (const r of store.recommendations) if (r.userId === where.userId && !r.completed && r.staleAt == null) { Object.assign(r, data); n++; }
      return { count: n };
    }),
    create: jest.fn(async ({ data }) => { const r = { id: 'rec-' + store.recommendations.length, completed: false, staleAt: null, ...data }; store.recommendations.push(r); return r; }),
  },
  notification: {
    deleteMany: jest.fn(async ({ where }) => {
      const before = store.notifications.length;
      store.notifications = store.notifications.filter(n => !(n.userId === where.userId && !n.read && where.type.in.includes(n.type)));
      return { count: before - store.notifications.length };
    }),
    create: jest.fn(async ({ data }) => { const n = { id: 'n-' + store.notifications.length, read: false, ...data }; store.notifications.push(n); return n; }),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/environmentService', () => ({
  fetchEnvironment: jest.fn(async () => { throw new Error('offline'); }),
  markStale: obs => obs,
}));
const app = require('../src/app');
const { invalidateSafetyAdvice, activityAdviceAllowed } = require('../src/services/activitySafety/recommendationSafety');
const setFlag = (k, v) => { process.env[envOverrideName(k)] = v; flags.resetCache(); };

beforeEach(() => {
  jest.clearAllMocks();
  store.recommendations.length = 0; store.notifications.length = 0; store.injuries.length = 0; store.symptoms.length = 0;
  ['activity_safety_engine', 'health_aware_recommendations', 'weather_intelligence_v2', 'activity_safety_shadow_mode'].forEach(k => setFlag(k, 'true'));
});

describe('J12 — cached recommendation invalidation', () => {
  test('injury write stamps open recommendations stale', async () => {
    store.recommendations.push({ id: 'r1', userId: 'u1', recommendationType: 'activity', recommendationText: 'Try a walk', completed: false, staleAt: null });
    await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1').send({ bodyPart: 'ankle', weightBearingRestriction: 'non_weight_bearing' });
    expect(store.recommendations[0].staleAt).toBeTruthy();
    expect(store.recommendations[0].staleReason).toBe('injury_reported');
  });
  test('completed/other-user recommendations untouched', async () => {
    store.recommendations.push({ id: 'r2', userId: 'u1', recommendationType: 'activity', recommendationText: 'x', completed: true, staleAt: null });
    store.recommendations.push({ id: 'r3', userId: 'u2', recommendationType: 'activity', recommendationText: 'x', completed: false, staleAt: null });
    await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1').send({ bodyPart: 'knee' });
    expect(store.recommendations[0].staleAt).toBeNull();
    expect(store.recommendations[1].staleAt).toBeNull();
  });
  test('symptom report invalidates too', async () => {
    store.recommendations.push({ id: 'r4', userId: 'u1', recommendationType: 'activity', recommendationText: 'x', completed: false, staleAt: null });
    const res = await request(app).post('/activity-safety/symptoms').set('x-user-id', 'u1').send({ symptoms: ['fatigue'] });
    expect(res.body.invalidated.recommendationsStale).toBe(1);
    expect(store.recommendations[0].staleAt).toBeTruthy();
  });
});

describe('J15 — delayed notification safety', () => {
  test('unread activity-advice notifications suppressed on new restriction write', async () => {
    store.notifications.push({ id: 'n1', userId: 'u1', type: 'activity.suggestion', title: 'Time to move', body: 'Try a run', read: false });
    store.notifications.push({ id: 'n2', userId: 'u1', type: 'trainer.plan_assigned', title: 'Plan', body: 'x', read: false });
    store.notifications.push({ id: 'n3', userId: 'u1', type: 'activity.suggestion', title: 'done', body: 'x', read: true });
    await request(app).post('/activity-safety/injuries').set('x-user-id', 'u1').send({ bodyPart: 'knee', weightBearingRestriction: 'non_weight_bearing' });
    expect(store.notifications.map(n => n.id)).toEqual(['n2', 'n3']); // unread advice gone; non-advice + already-read kept
  });
  test('invalidateSafetyAdvice is user-scoped', async () => {
    store.notifications.push({ id: 'n4', userId: 'u2', type: 'activity.suggestion', title: 'x', body: 'x', read: false });
    const r = await invalidateSafetyAdvice(mockPrisma, 'u1', 'test');
    expect(r.notificationsSuppressed).toBe(0);
    expect(store.notifications.length).toBe(1);
  });
  test('activityAdviceAllowed suppresses pushes for active restrictions', async () => {
    // u1 now has an NWB ankle in the store → gate suppresses activity pushes.
    store.injuries.push({ id: 'i9', userId: 'u1', bodyPart: 'ankle', type: 'fracture', status: 'current', weightBearingRestriction: 'non_weight_bearing', prohibitedCategories: [] });
    const r = await activityAdviceAllowed(mockPrisma, 'u1');
    expect(r.allowed).toBe(false);
    const r2 = await activityAdviceAllowed(mockPrisma, 'u2'); // no records → allowed
    expect(r2.allowed).toBe(true);
  });
});
