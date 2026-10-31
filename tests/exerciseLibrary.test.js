const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/exercises', require('../src/routes/exercises'));

const mk = (id, name, equipment, primary, secondary = [], extra = {}) => prisma.exercise.upsert({
  where: { normalizedName: id },
  update: {},
  create: {
    id, normalizedName: id, name, equipment: equipment[0], appEquipment: equipment, level: 'beginner',
    force: 'push', mechanic: 'compound', instructions: ['do it'], source: 'test',
    muscles: { create: [...primary.map(m => ({ muscle: m, role: 'primary' })), ...secondary.map(m => ({ muscle: m, role: 'secondary' }))] },
    ...extra,
  },
});

beforeAll(async () => {
  await mk('humai-test-press', 'Humai Test Press', ['barbell'], ['pectoralis-major'], ['triceps-brachii']);
  await mk('humai-test-press-db', 'Humai Test Press DB', ['dumbbell'], ['pectoralis-major'], ['triceps-brachii']);
  await mk('humai-test-squat', 'Humai Test Squat', ['bodyweight'], ['quadriceps'], ['gluteus-maximus'], { force: 'push', mechanic: 'compound' });
});

describe('exercise library endpoints', () => {
  it('filters search by muscle and role', async () => {
    const res = await request(app).get('/exercises/library/search?q=humai+test&muscle=pectoralis-major&role=primary');
    expect(res.status).toBe(200);
    const names = res.body.exercises.map(e => e.name);
    expect(names).toContain('Humai Test Press');
    expect(names).not.toContain('Humai Test Squat');
  });

  it('filters by equipment and mechanic', async () => {
    const res = await request(app).get('/exercises/library/search?q=humai+test&equipment=dumbbell&mechanic=compound');
    expect(res.body.exercises.some(e => e.id === 'humai-test-press-db')).toBe(true);
    expect(res.body.exercises.every(e => e.appEquipment.includes('dumbbell'))).toBe(true);
  });

  it('returns alternatives with explanations and respects equipment', async () => {
    const res = await request(app).get('/exercises/library/humai-test-press/alternatives?equipment=dumbbell');
    expect(res.status).toBe(200);
    expect(res.body.alternatives.length).toBeGreaterThan(0);
    expect(res.body.alternatives[0].why).toMatch(/Pectoralis/);
    expect(res.body.alternatives.every(a => a.exercise.appEquipment.includes('dumbbell'))).toBe(true);
    expect(res.body.alternatives.every(a => a.exercise.primaryMuscles.includes('pectoralis-major') ||
      a.exercise.primaryMuscles.some(m => res.body.exercise.secondaryMuscles.includes(m)))).toBe(true);
  });

  it('aggregates muscle heatmap from finished sessions only', async () => {
    await prisma.user.upsert({ where: { id: 'lib-heat-u' }, update: {}, create: { id: 'lib-heat-u', email: 'lib-heat-u@device.local' } });
    await prisma.exerciseSet.deleteMany({ where: { workoutSession: { userId: 'lib-heat-u' } } });
    await prisma.workoutSession.deleteMany({ where: { userId: 'lib-heat-u' } });
    const done = await prisma.workoutSession.create({ data: {
      userId: 'lib-heat-u', workoutType: 'strength', durationMinutes: 30,
      startedAt: new Date(), endedAt: new Date(), finishedAt: new Date(),
    } });
    const draft = await prisma.workoutSession.create({ data: {
      userId: 'lib-heat-u', workoutType: 'strength', durationMinutes: 0,
      startedAt: new Date(), endedAt: new Date(), finishedAt: null,
    } });
    await prisma.exerciseSet.create({ data: { workoutSessionId: done.id, exerciseName: 'humai-test-press', reps: 10, weightLbs: 100, setNumber: 1 } });
    await prisma.exerciseSet.create({ data: { workoutSessionId: draft.id, exerciseName: 'humai-test-press', reps: 10, weightLbs: 100, setNumber: 1 } });

    const res = await request(app).get('/exercises/library/muscle-heatmap?days=7').set('x-user-id', 'lib-heat-u');
    expect(res.status).toBe(200);
    expect(res.body.muscles['pectoralis-major'].sets).toBe(1);          // primary ×1.0
    expect(res.body.muscles['triceps-brachii'].sets).toBe(0.5);          // secondary ×0.5
    expect(res.body.muscles['pectoralis-major'].volumeLoadLbs).toBe(1000);
    expect(res.body.muscles['quadriceps']).toBeUndefined();
  });
});
