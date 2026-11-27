// pc-HUM-44 — every activity-suggesting producer must fail CLOSED when the
// shared safety gate throws (unverifiable safety state ≠ unrestricted).
// The gate module is mocked to reject so each producer's catch path is hit.

const mockGate = jest.fn(async () => { throw new Error('safety context db unreachable'); });
jest.mock('../src/services/activitySafety/gate', () => {
  const actual = jest.requireActual('../src/services/activitySafety/gate');
  return { ...actual, safetyGate: (...a) => mockGate(...a) };
});

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => key === 'ai_workout_recommendations' ? true : Boolean(mockFlags[key]),
  isAiShutdown: async () => false,
}));

const mockPrisma = {};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: jest.fn(() => true) }));

const { opportunities } = require('../src/services/progressCoach');
const { getSleepRecoverySummary } = require('../src/services/sleepRecovery');
const { composeReview } = require('../src/services/weeklyHealthReview');

const empty = (v = []) => jest.fn(async () => v);

function progressModels() {
  return {
    foodLog: { findMany: empty() },
    waterLog: { aggregate: empty({ _sum: { amountMl: 0 } }) },
    dailySteps: { findFirst: empty(null) },
    workoutSession: { findMany: empty() },
    sleepLog: { findMany: empty() },
    habitCompletion: { findMany: empty() },
    reminderCategorySetting: { findMany: empty() },
    macroGoal: { findUnique: empty(null) },
    userPlanningPreferences: { findUnique: empty(null) },
    habit: { count: empty(0) },
    dailyProgressDay: { upsert: empty({}), findMany: empty() },
    userStreakPreferences: { findUnique: empty(null), upsert: empty({}) },
    user: { findUnique: empty({ goalType: 'fitness', timeZone: 'UTC' }) },
  };
}

function reviewModels() {
  return {
    user: { findUnique: empty({ goalType: 'fitness' }), update: empty({}) },
    foodLog: { groupBy: empty() },
    workoutSession: { findMany: empty() },
    habitCompletion: { findMany: empty() },
    wellnessCheckIn: { findMany: empty() },
    trainerClient: { findFirst: empty(null) },
    emotionalCheckIn: { findMany: empty() },
    userMindPreferences: { findUnique: empty(null) },
    healthMeasurement: { findMany: empty() },
    sleepLog: { findMany: empty() },
    checkIn: { findFirst: empty(null), findUnique: empty(null) },
    outcomePlan: { findFirst: empty(null) },
    knowledgeArticle: { findMany: empty() },
    knowledgeArticleRevision: { findMany: empty() },
    weeklyHealthReview: { upsert: jest.fn(async ({ create }) => ({ id: 'w1', ...create })) },
  };
}

function install(models) { for (const k of Object.keys(mockPrisma)) delete mockPrisma[k]; Object.assign(mockPrisma, models); }
beforeEach(() => { jest.clearAllMocks(); mockGate.mockImplementation(async () => { throw new Error('safety context db unreachable'); }); });

describe('gate error → producers fail closed', () => {
  test('progressCoach: activity opportunity suppressed on gate throw', async () => {
    install(progressModels());
    const r = await opportunities('u1', { tz: 'UTC', now: new Date('2026-11-17T17:00:00Z') });
    expect(r.all.some(o => o.component === 'activity')).toBe(false);
    expect(r.activitySafety?.activityPushesSuppressed).toBe(true);
  });

  test('sleepRecovery: short sleep + gate throw → rest, never lighter_intensity', async () => {
    const mkLog = (h) => ({ sleepStart: new Date(Date.now() - (h + 8) * 3600000), sleepEnd: new Date(Date.now() - 8 * 3600000), hoursSlept: h, source: 'app' });
    install({ sleepLog: { findMany: empty([mkLog(5), mkLog(5), mkLog(5), mkLog(5)]) }, checkIn: { findFirst: empty(null) }, user: { findUnique: empty({ sleepGoalHours: 8 }) } });
    const r = await getSleepRecoverySummary('u1');
    expect(r.suggestion).toBe('rest');
  });

  test('weeklyHealthReview: gate throw → no workout pushes in review', async () => {
    install(reviewModels());
    const r = await composeReview('u1', { tz: 'UTC' });
    expect(r.opportunities.some(o => /workout/i.test(o.text))).toBe(false);
    expect(r.nextWeekFocus).not.toMatch(/one workout/i);
  });

  test('personalPlans draft: gate throw → 503, never an unconstrained plan', async () => {
    const express = require('express');
    const request = require('supertest');
    install({ user: { findUnique: empty({ goalType: 'fitness' }) } });
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
    a.use('/personal-plans', require('../src/routes/personalPlans'));
    a.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    const res = await request(a).post('/personal-plans/draft').set('x-user-id', 'u1').send({ preferences: {} });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/safety context unavailable/i);
  });
});
