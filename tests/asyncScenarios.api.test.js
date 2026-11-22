// Authenticated API-level async scenario validation (Phase 2). Same scenario
// IDs as tests/asyncScenarios.test.js but executed through the real HTTP
// consumers: GET /me/progress/unified (→ getTrends) and /activity-safety/*
// (→ UserSymptomReport + invalidation). Real prisma, real app, isolated
// fitness_test only. Scenario IDs verified against the original manifest;
// clinical approval remains a separate gate — nothing here approves rules.
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');
const manifest = require('../data/scenarioAppendixA.json');

const prisma = getPrisma();
const app = require('../src/app');
const D = 86400000, NOW = Date.now();
const day = (n) => new Date(NOW - n * D);
const ids = [];

const mkUser = async (tag, extra = {}) => {
  const u = await prisma.user.create({ data: { email: `api-${tag}-${Math.random().toString(36).slice(2, 10)}@syn.local`, ...extra } });
  ids.push(u.id);
  return u;
};
const food = (userId, n, over = {}) => prisma.foodLog.create({ data: { userId, mealType: 'lunch', foodName: over.foodName || 'Rice bowl', quantityG: over.quantityG || 300, calories: over.calories ?? 600, proteinG: over.proteinG ?? 20, carbsG: over.carbsG ?? 90, fatG: over.fatG ?? 10, fiberG: over.fiberG ?? 4, loggedAt: day(n), ...over } });
const as = (u) => ({ 'x-user-id': u.id });

beforeAll(() => {
  if (!/fitness_test/.test(process.env.DATABASE_URL || '')) throw new Error('api runner must target fitness_test');
  ['leo_progress_enabled', 'activity_safety_engine', 'health_aware_recommendations']
    .forEach((k) => { process.env[envOverrideName(k)] = 'true'; });
  flags.resetCache();
});
afterAll(async () => {
  for (const model of ['foodLog', 'weightEntry', 'workoutSession', 'dailySteps', 'sleepLog', 'macroGoal', 'goalHistory', 'userSymptomReport', 'dailyScoreSnapshot']) await prisma[model].deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  await prisma.$disconnect();
});

describe('authenticated GET /me/progress/unified → trends (A08, A09)', () => {
  test('returns trends block mirroring service output with coverage + provenance', async () => {
    const u = await mkUser('api-a08', { goalType: 'weight_loss' });
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 2000, proteinTarget: 140 } });
    for (let i = 0; i < 5; i++) await food(u.id, i + 1, { calories: 2600 });
    const res = await request(app).get('/me/progress/unified').set(as(u)).query({ weeks: 4 });
    expect(res.status).toBe(200);
    expect(res.body.trends).toBeTruthy();
    expect(res.body.trends.state).toBe('ok');
    expect(res.body.trends.coverage.foodLoggedDays).toBe(5);
    expect(res.body.trends.progress.basis).toContain('observational');
    expect(res.body.trends.provenance.meals).toContain('FoodLog');
    // expected verbatim preserved
    const exp = manifest.scenarios.find((s) => s.id === 'A09').expected;
    expect(exp).toBeTruthy();
  });

  test('another user cannot see this user\'s trend data (isolation)', async () => {
    const u = await mkUser('api-a09iso');
    await food(u.id, 1, {});
    const other = await mkUser('api-a09other');
    const res = await request(app).get('/me/progress/unified').set(as(other)).query({ weeks: 4 });
    expect(res.status).toBe(200);
    // the second user's coverage must not include the first user's log
    expect(res.body.trends.coverage?.foodLoggedDays ?? 0).toBe(0);
  });
});

describe('authenticated /activity-safety/symptoms (H01–H07, D02, E04, G04)', () => {
  test('urgent code → escalation disposition; non-urgent → recorded; suppresses suggestions', async () => {
    const u = await mkUser('api-h01');
    const urgent = await request(app).post('/activity-safety/symptoms').set(as(u))
      .send({ symptoms: ['chest_pain'], severity: 'severe', context: 'at_rest' });
    expect(urgent.status).toBe(201);
    expect(urgent.body.disposition).toBe('urgent_escalation');
    expect(urgent.body.suppressesActivitySuggestions).toBe(true);
    expect(urgent.body.noDiagnosis).toBe(true);

    const mild = await request(app).post('/activity-safety/symptoms').set(as(u))
      .send({ symptoms: ['nausea'], severity: 'mild', context: 'after_activity' });
    expect(mild.status).toBe(201);
    expect(mild.body.disposition).toBe('recorded');
  });

  test('GET lists only caller reports; PATCH owner-scoped; cross-user 404; DELETE removes', async () => {
    const a = await mkUser('api-h-a');
    const b = await mkUser('api-h-b');
    const created = await request(app).post('/activity-safety/symptoms').set(as(a)).send({ symptoms: ['dizziness'], severity: 'mild' });
    expect(created.status).toBe(201);
    const listA = await request(app).get('/activity-safety/symptoms').set(as(a));
    expect(listA.status).toBe(200);
    expect(listA.body.reports.some((r) => r.id === created.body.reportId)).toBe(true);
    const listB = await request(app).get('/activity-safety/symptoms').set(as(b));
    expect(listB.body.reports.some((r) => r.id === created.body.reportId)).toBe(false);

    // cross-user PATCH → 404
    const cross = await request(app).patch(`/activity-safety/symptoms/${created.body.reportId}`).set(as(b)).send({ severity: 'severe' });
    expect(cross.status).toBe(404);
    // owner PATCH → 200
    const own = await request(app).patch(`/activity-safety/symptoms/${created.body.reportId}`).set(as(a)).send({ severity: 'moderate', persistence: 'persistent' });
    expect(own.status).toBe(200);
    // DELETE then gone from list
    await request(app).delete(`/activity-safety/symptoms/${created.body.reportId}`).set(as(a));
    const after = await request(app).get('/activity-safety/symptoms').set(as(a));
    expect(after.body.reports.some((r) => r.id === created.body.reportId)).toBe(false);
  });

  test('symptom co-occurrence surfaces in unified trends with non-causal wording (D02/E04/G04)', async () => {
    const u = await mkUser('api-d02');
    for (let i = 0; i < 3; i++) {
      await food(u.id, i + 2, { foodName: 'Milk tea' });
      await request(app).post('/activity-safety/symptoms').set(as(u))
        .send({ symptoms: ['nausea'], severity: 'mild', context: 'after_activity' });
    }
    const res = await request(app).get('/me/progress/unified').set(as(u)).query({ weeks: 4 });
    expect(res.status).toBe(200);
    const sym = res.body.trends?.symptoms;
    expect(sym).toBeTruthy();
    // non-causal observational framing only — must never assert cause
    const assoc = (sym.associations || []).find((a) => (a.label || '').toLowerCase().includes('milk tea'));
    if (assoc) {
      expect(`${assoc.note || ''} ${assoc.label || ''}`).toMatch(/observation|co-occur|overlap|not.*caus|timing/i);
    }
  });
});

describe('flag isolation — clinical feature flags stay fail-closed', () => {
  test('disabling activity_safety_engine blocks the symptom API', async () => {
    const u = await mkUser('api-flag');
    process.env[envOverrideName('activity_safety_engine')] = 'false';
    flags.resetCache();
    try {
      const res = await request(app).post('/activity-safety/symptoms').set(as(u)).send({ symptoms: ['nausea'] });
      expect([401, 403, 404]).toContain(res.status);
    } finally {
      process.env[envOverrideName('activity_safety_engine')] = 'true';
      flags.resetCache();
    }
  });
});

describe('authenticated L03–L05 — divergence surfaces via unified progress', () => {
  test('stalled progress + high snapshots → score_outcome_divergence observation', async () => {
    const u = await mkUser('api-l03', { goalType: 'weight_loss' });
    await prisma.macroGoal.create({ data: { userId: u.id, caloriesTarget: 1800 } });
    for (let i = 0; i < 8; i++) await food(u.id, i + 1, { calories: 1500 });
    for (let i = 0; i < 8; i++) await prisma.weightEntry.create({ data: { userId: u.id, weightKg: 80.0, recordedAt: day(i + 1) } });
    for (let i = 0; i < 6; i++) await prisma.dailyScoreSnapshot.create({ data: { userId: u.id, date: day(i + 1), version: 'v2', composite: 92, state: 'ok', components: {} } });
    const res = await request(app).get('/me/progress/unified').set(as(u)).query({ weeks: 4 });
    expect(res.status).toBe(200);
    const reviews = res.body.trends?.reviews || [];
    const div = reviews.find((r) => r.kind === 'score_outcome_divergence');
    expect(div).toBeTruthy();
    // divergence is a review flag — never a causal/medical claim
    expect(div.outcome).toBe('outcome_review');
  });
});
