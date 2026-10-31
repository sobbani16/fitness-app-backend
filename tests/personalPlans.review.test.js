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
