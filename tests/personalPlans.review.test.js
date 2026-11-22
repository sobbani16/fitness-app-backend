jest.mock('../src/lib/prisma', () => ({ getPrisma: jest.fn() }));
const { getPrisma } = require('../src/lib/prisma');
const express = require('express'), request = require('supertest');
const app = express(); app.use(express.json()); app.use('/personal-plans', require('../src/routes/personalPlans'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
let prisma;
const plan = { id: 'p1', userId: 'alice', status: 'draft', preferences: { equipment: ['bodyweight'] }, plan: { days: [{ weekday: 'mon', exercises: [{ exerciseId: 'push-up', sets: 2, reps: '10', restSec: 60 }] }] } };
beforeEach(() => {
  prisma = { $queryRaw: jest.fn(), userWorkoutPlan: { findUnique: jest.fn(async () => plan), findFirst: jest.fn(async () => plan), update: jest.fn(), updateMany: jest.fn() }, workoutSession: { findMany: jest.fn(async () => []) } };
  prisma.$transaction = jest.fn(async action => action(prisma));
  // Safety-gate models — empty by default; tests override per-case.
  prisma.user = { findUnique: jest.fn(async () => null) };
  prisma.userActivityProfile = { findUnique: jest.fn(async () => null) };
  prisma.userInjury = { findMany: jest.fn(async () => []) };
  prisma.userSurgery = { findMany: jest.fn(async () => []) };
  prisma.userActivityRestriction = { findMany: jest.fn(async () => []) };
  prisma.userSymptomReport = { findMany: jest.fn(async () => []) };
  prisma.userHealthCondition = { findMany: jest.fn(async () => []) };
  prisma.activitySafetyRule = { findMany: jest.fn(async () => []) };
  getPrisma.mockReturnValue(prisma);
});
test('revalidates and serializes confirmation and refuses archived plans', async () => {
  await request(app).post('/personal-plans/p1/confirm').set('x-user-id', 'alice').send({}).expect(200);
  expect(prisma.$queryRaw).toHaveBeenCalled();
  expect(prisma.userWorkoutPlan.updateMany).toHaveBeenCalledWith({ where: { userId: 'alice', status: 'active' }, data: { status: 'archived' } });
  prisma.userWorkoutPlan.findUnique.mockResolvedValue({ ...plan, status: 'archived' });
  await request(app).post('/personal-plans/p1/confirm').set('x-user-id', 'alice').send({}).expect(409);
});
test('refuses activation of an unsuitable stored draft', async () => {
  prisma.userWorkoutPlan.findUnique.mockResolvedValue({ ...plan, preferences: { limitations: ['rehab'] } });
  await request(app).post('/personal-plans/p1/confirm').set('x-user-id', 'alice').send({}).expect(400);
  expect(prisma.userWorkoutPlan.update).not.toHaveBeenCalled();
});
test('uses the most recent history and matches canonical hyphenated exercise names', async () => {
  const sets = [{ exerciseName: 'push-up', reps: 10, weightLbs: 0 }];
  prisma.workoutSession.findMany.mockResolvedValue([{ exerciseSets: sets }, { exerciseSets: sets }]);
  const result = await request(app).get('/personal-plans/suggestions?rir=3').set('x-user-id', 'alice').expect(200);
  expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { startedAt: 'desc' }, take: 20 }));
  expect(result.body.suggestions[0]).toMatchObject({ exerciseId: 'push-up', direction: 'increase', evidence: { sessions: 2 } });
});

test('does not reuse comfort feedback from an older completed session', async () => {
  prisma.workoutSession.findMany.mockResolvedValue(['new', 'old'].map(id => ({ id, exerciseSets: [{ exerciseName: 'push-up', reps: 10, weightLbs: 0 }] })));
  const feedback = JSON.stringify({ 'push-up': { sessionId: 'old', rir: 3 } });
  const result = await request(app).get('/personal-plans/suggestions').query({ feedback }).set('x-user-id', 'alice').expect(200);
  expect(result.body.suggestions[0].direction).toBe('maintain');
});

test('progression suggestion degrades to review when a recorded restriction conflicts', async () => {
  // Plan says push-up and history supports progression — but a recorded
  // restriction on upper-limb load must coerce the suggestion to review.
  prisma.userWorkoutPlan.findFirst.mockResolvedValue({ ...plan, status: 'active' });
  prisma.userActivityRestriction.findMany.mockResolvedValue([
    { status: 'active', categories: ['upper_limb_load'], severity: 'prohibited', source: 'clinician_documented' },
  ]);
  const sets = [{ exerciseName: 'push-up', reps: 10, weightLbs: 0 }];
  prisma.workoutSession.findMany.mockResolvedValue([{ exerciseSets: sets }, { exerciseSets: sets }]);
  const res = await request(app).get('/personal-plans/suggestions?rir=3').set('x-user-id', 'alice').expect(200);
  expect(res.body.suggestions[0].direction).toBe('review');
  expect(res.body.suggestions[0].safetyConflict).toBe(true);
  expect(res.body.suggestions[0].suggested).toBeUndefined();
});

test('catalog picker applies server-derived restrictions even when omitted from the query', async () => {
  prisma.userActivityRestriction.findMany.mockResolvedValue([
    { status: 'active', categories: ['upper_limb_load'], bodyRegions: ['upper_limb'], severity: 'prohibited', source: 'clinician_documented' },
  ]);
  const res = await request(app).get('/personal-plans/catalog').set('x-user-id', 'alice').expect(200);
  expect(res.body.safetyApplied).toBe(true);
  const push = res.body.exercises.find(e => e.id === 'push-up');
  expect(['review', 'adapt']).toContain(push.suitability.status);
});
