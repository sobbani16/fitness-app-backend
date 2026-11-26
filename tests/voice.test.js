const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => true, synthesizeSpeech: jest.fn() }));
const { askJSON, synthesizeSpeech } = require('../src/services/aiProvider');

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/voice', require('../src/routes/voice'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const U = 'voice-test-u';
const H = { 'x-user-id': U };

beforeAll(async () => {
  // Self-sufficient flag state — voice routes are requireAnyFeature-gated;
  // without this the suite only passes when another suite leaks FF_* envs.
  const { envOverrideName } = require('../src/config/featureRegistry');
  ['voice_food_logging', 'voice_exercise_logging', 'manual_food_logging', 'manual_exercise_logging']
    .forEach(k => { process.env[envOverrideName(k)] = 'true'; });
  require('../src/services/featureFlags/service').resetCache();
  await prisma.user.upsert({ where: { id: U }, update: {}, create: { id: U, email: `${U}@device.local` } });
  await prisma.voiceCommand.deleteMany({ where: { userId: U } }); // re-runnable: clear prior runs
  await prisma.waterLog.deleteMany({ where: { userId: U } });
  await prisma.exerciseSet.deleteMany({ where: { workoutSession: { userId: U, source: 'voice' } } });
  await prisma.workoutSession.deleteMany({ where: { userId: U, source: 'voice' } });
  await prisma.foodLog.deleteMany({ where: { userId: U } });
  await prisma.ingredient.upsert({
    where: { id: 'humai-test-rice-ing' }, update: {},
    create: { id: 'humai-test-rice-ing', normalizedName: 'humai test rice', name: 'Humai Test Rice', caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3, source: 'test' },
  });
  await prisma.exercise.upsert({
    where: { normalizedName: 'humai-test-curl' }, update: {},
    create: { id: 'humai-test-curl', normalizedName: 'humai-test-curl', name: 'Humai Test Curl', equipment: 'dumbbell', appEquipment: ['dumbbell'], level: 'beginner', force: 'pull', mechanic: 'isolation', instructions: ['curl'], source: 'test',
      muscles: { create: [{ muscle: 'biceps-brachii', role: 'primary' }] } },
  });
});

describe('voice endpoints', () => {
  it('interpret parses water as ready', async () => {
    const res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'add 500 ml of water' });
    expect(res.status).toBe(200);
    expect(res.body.actions[0]).toMatchObject({ intent: 'LOG_WATER', status: 'ready', entities: { amountMl: 500 } });
  });

  it('interpret resolves exercise to a server-side match', async () => {
    const res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'log 2 sets of humai test curl, 10 reps at 20 pounds' });
    const act = res.body.actions[0];
    expect(act.intent).toBe('LOG_EXERCISE_SET');
    expect(act.entities.exerciseId).toBe('humai-test-curl');
    expect(act.matches[0].name).toBe('Humai Test Curl');
  });

  it('execute writes a water log and is idempotent on commandId', async () => {
    const body = { commandId: 'vc-water-1', transcript: 'add 500 ml of water',
      actions: [{ intent: 'LOG_WATER', entities: { amountMl: 500 }, status: 'ready' }] };
    const r1 = await request(app).post('/voice/commands/execute').set(H).send(body);
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/voice/commands/execute').set(H).send(body);
    expect(r2.body.deduplicated).toBe(true);
    expect(await prisma.waterLog.count({ where: { userId: U, amountMl: 500 } })).toBe(1);
  });

  it('execute logs an exercise set into a workout session', async () => {
    const res = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-set-1', transcript: '3 sets of humai test curl',
      actions: [{ intent: 'LOG_EXERCISE_SET', entities: { exerciseId: 'humai-test-curl', exerciseName: 'humai test curl', sets: 3, reps: 10, weight: 20, weightUnit: 'lbs' }, status: 'ready' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.result[0].status).toBe('saved');
    const session = await prisma.workoutSession.findFirst({ where: { id: res.body.createdEntities[0].id }, include: { exerciseSets: true } });
    expect(session.exerciseSets.length).toBe(3);
    expect(session.exerciseSets[0]).toMatchObject({ reps: 10, weightLbs: 20 });
  });

  it('execute logs food with calculated nutrition snapshot', async () => {
    const res = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-food-1', transcript: 'add 150 grams humai test rice',
      actions: [{ intent: 'LOG_FOOD', entities: { items: [{ name: 'humai test rice', grams: 150 }], mealType: 'lunch' }, status: 'ready' }],
    });
    expect(res.status).toBe(201);
    const log = await prisma.foodLog.findFirst({ where: { id: `voice-vc-food-1-0` } });
    expect(log).toBeTruthy();
    expect(log.quantityG).toBe(150);
    expect(log.calories).toBeCloseTo(195, 0); // 130/100g × 150g
    expect(log.mealType).toBe('lunch');
  });

  it('skips needs_review actions without writing', async () => {
    const res = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-skip-1', transcript: 'log something vague',
      actions: [{ intent: 'LOG_EXERCISE_SET', entities: { exerciseName: null }, status: 'needs_review', missing: ['exercise'] }],
    });
    expect(res.body.result[0].status).toBe('skipped');
    expect(await prisma.workoutSession.count({ where: { userId: U, source: 'voice' } })).toBe(1); // only vc-set-1
  });

  it('undo deletes created entities and marks the command', async () => {
    const res = await request(app).post('/voice/commands/undo').set(H).send({ commandId: 'vc-water-1' });
    expect(res.body.undone).toBe(true);
    expect(await prisma.waterLog.count({ where: { userId: U, amountMl: 500 } })).toBe(0);
    const again = await request(app).post('/voice/commands/undo').set(H).send({ commandId: 'vc-water-1' });
    expect(again.body.already).toBe(true);
  });

  it('UPDATE_EXERCISE_SET edits the most recent set and undo restores it', async () => {
    const res = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-upd-1', transcript: 'change my last set to 12 reps',
      actions: [{ intent: 'UPDATE_EXERCISE_SET', entities: { reps: 12 }, status: 'ready' }],
    });
    expect(res.body.result[0].status).toBe('saved');
    // vc-set-1's session is the user's latest — its last set should now be 12
    const sets = await prisma.exerciseSet.findMany({ where: { workoutSession: { userId: U, source: 'voice' } }, orderBy: { setNumber: 'desc' } });
    expect(sets[0].reps).toBe(12);
    await request(app).post('/voice/commands/undo').set(H).send({ commandId: 'vc-upd-1' });
    expect((await prisma.exerciseSet.findUnique({ where: { id: sets[0].id } })).reps).toBe(10);
  });

  it('START_WORKOUT opens a session and COMPLETE_WORKOUT closes it', async () => {
    const s = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-start-1', transcript: 'start my leg day workout',
      actions: [{ intent: 'START_WORKOUT', entities: { name: 'leg day' }, status: 'ready' }],
    });
    const open = await prisma.workoutSession.findUnique({ where: { id: s.body.createdEntities[0].id } });
    expect(open.finishedAt).toBeNull();
    expect(open.workoutType).toBe('leg day');
    const c = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-done-1', transcript: 'finish my workout',
      actions: [{ intent: 'COMPLETE_WORKOUT', entities: {}, status: 'ready' }],
    });
    expect(c.body.result[0].status).toBe('saved');
    expect((await prisma.workoutSession.findUnique({ where: { id: open.id } })).finishedAt).not.toBeNull();
  });

  it('voice UNDO_ACTION reverses the previous command', async () => {
    await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-water-2', transcript: 'add 250 ml water',
      actions: [{ intent: 'LOG_WATER', entities: { amountMl: 250 }, status: 'ready' }],
    });
    const res = await request(app).post('/voice/commands/execute').set(H).send({
      commandId: 'vc-undo-1', transcript: 'undo that',
      actions: [{ intent: 'UNDO_ACTION', entities: {}, status: 'ready' }],
    });
    expect(res.body.result[0].status).toBe('saved');
    expect(await prisma.waterLog.count({ where: { userId: U, amountMl: 250 } })).toBe(0);
  });

  it('interpret fills UNKNOWN_INTENT segments with validated AI proposals', async () => {
    askJSON.mockResolvedValueOnce({ actions: [
      { intent: 'LOG_WATER', segment: 'drink half a litre', exerciseName: null, sets: null, reps: null, weight: null, weightUnit: null, amountMl: 500, mealType: null, name: null, items: [] },
    ] });
    const res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'drink half a litre' });
    const act = res.body.actions[0];
    expect(act.intent).toBe('LOG_WATER');
    expect(act.entities.amountMl).toBe(500);
    expect(act.status).toBe('ready');
    expect(act.source).toBe('ai');
  });

  it('interpret keeps UNKNOWN_INTENT when AI proposes an invalid intent or fails', async () => {
    askJSON.mockResolvedValueOnce({ actions: [
      { intent: 'DELETE_EVERYTHING', segment: 'x', exerciseName: null, sets: null, reps: null, weight: null, weightUnit: null, amountMl: null, mealType: null, name: null, items: [] },
    ] });
    let res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'blah blah nonsense' });
    expect(res.body.actions[0].intent).toBe('UNKNOWN_INTENT');
    askJSON.mockRejectedValueOnce(new Error('ai down'));
    res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'still nonsense' });
    expect(res.status).toBe(200);
    expect(res.body.actions[0].intent).toBe('UNKNOWN_INTENT');
  });

  it('interpret does not call AI for segments the parser already handles', async () => {
    askJSON.mockClear();
    await request(app).post('/voice/interpret').set(H).send({ transcript: 'add 500 ml of water' });
    expect(askJSON).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated execute', async () => {
    const res = await request(app).post('/voice/commands/execute').send({ commandId: 'vc-x', actions: [{ intent: 'LOG_WATER' }] });
    expect(res.status).toBe(401);
  });
});

describe('server-side context fill (interpret)', () => {
  beforeAll(async () => {
    const session = await prisma.workoutSession.create({ data: {
      userId: U, workoutType: 'strength', durationMinutes: 5,
      startedAt: new Date(), endedAt: new Date(), finishedAt: new Date(), source: 'manual',
      exerciseSets: { create: [{ exerciseName: 'Humai Test Curl', reps: 8, weightLbs: 25, setNumber: 1 }] },
    } });
    expect(session.id).toBeTruthy();
  });
  it('"change the last set" is ready without client ctx — server resolves the latest set', async () => {
    const res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'change the last set to 12 reps' });
    const a = res.body.actions[0];
    expect(a).toMatchObject({ intent: 'UPDATE_EXERCISE_SET', status: 'ready', resolvedFrom: 'latest_session' });
    expect(a.entities.setId).toBeTruthy();
    expect(a.entities.reps).toBe(12);
  });
  it('"same weight, 8 more reps" fills exercise + weight from the latest set', async () => {
    const res = await request(app).post('/voice/interpret').set(H).send({ transcript: 'same weight, 8 more reps' });
    const a = res.body.actions[0];
    expect(a.intent).toBe('LOG_EXERCISE_SET');
    expect(a.entities).toMatchObject({ exerciseName: 'Humai Test Curl', reps: 8, weight: 25, weightUnit: 'lbs' });
  });
  it('user with no sets still gets needs_review — nothing to resolve', async () => {
    const res = await request(app).post('/voice/interpret').set({ 'x-user-id': 'voice-ctx-empty' }).send({ transcript: 'change the last set to 9 reps' });
    expect(res.body.actions[0].status).toBe('needs_review');
  });
});

describe('/voice/speak', () => {
  it('requires text and caps length', async () => {
    expect((await request(app).post('/voice/speak').set(H).send({})).status).toBe(400);
    expect((await request(app).post('/voice/speak').set(H).send({ text: 'x'.repeat(601) })).status).toBe(413);
  });
  it('returns an mp3 stream through the gated provider', async () => {
    synthesizeSpeech.mockResolvedValueOnce(Buffer.from('ID3fake'));
    const res = await request(app).post('/voice/speak').set(H).send({ text: 'Nice work — 10 reps logged.' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(synthesizeSpeech).toHaveBeenCalledWith('Nice work — 10 reps logged.', U);
  });


  it('execute orders mutations before read/summary actions regardless of input order', async () => {
    // "tell remaining fiber, log 500 ml water" — the read arrives first in input
    // order but must execute AFTER the mutation so answers reflect the write.
    askJSON.mockResolvedValue(null);
    const interp = await request(app).post('/voice/interpret').set(H).send({ transcript: 'add 500 ml water' });
    const waterAction = interp.body.actions.find(a => a.intent === 'LOG_WATER');
    const commandId = 'ordertest' + Math.random().toString(36).slice(2, 10);
    const r = await request(app).post('/voice/commands/execute').set(H).send({
      commandId, transcript: 'test',
      actions: [
        { intent: 'ASK_FIBER', entities: {}, segment: 'how much fiber', status: 'ready' },
        { ...waterAction, status: 'ready' },
      ],
    });
    expect([200, 201]).toContain(r.status);
    const intents = r.body.result.map(x => x.intent);
    expect(intents.indexOf('LOG_WATER')).toBeLessThan(intents.indexOf('ASK_FIBER'));
  });

  it('budget: interpret refuses with 429 after the per-user rate budget is exhausted', async () => {
    askJSON.mockResolvedValue(null);
    const prev = process.env.VOICE_INTERpret_BUDGET_PER_MIN;
    process.env.VOICE_INTERPRET_BUDGET_PER_MIN = '2';
    try {
      let lastStatus = 0;
      for (let i = 0; i < 4; i++) {
        const r = await request(app).post('/voice/interpret').set(H).send({ transcript: 'add 100 ml water', budgetProbe: i + '-' + Date.now() });
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(429);
    } finally {
      if (prev == null) delete process.env.VOICE_INTERPRET_BUDGET_PER_MIN; else process.env.VOICE_INTERPRET_BUDGET_PER_MIN = prev;
    }
  });
});
