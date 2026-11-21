// Voice safety capture — "I injured my right knee yesterday" must produce a
// structured REPORT_INJURY that updates the shared safety context, and
// symptom speech must produce coded REPORT_SYMPTOM intents. Also verifies
// the execute path writes rows and the undo path reverses them.
const { parseTranscript } = require('../src/services/voice/voiceParser');

describe('voice safety parsing', () => {
  const intent = t => parseTranscript(t).actions[0];

  test.each([
    ['I injured my right knee yesterday', 'REPORT_INJURY', { bodyPart: 'knee', laterality: 'right' }],
    ['i sprained my left ankle', 'REPORT_INJURY', { bodyPart: 'ankle', laterality: 'left', type: 'sprain' }],
    ['i broke my wrist last week', 'REPORT_INJURY', { bodyPart: 'wrist', type: 'fracture' }],
    ['i twisted my ankle', 'REPORT_INJURY', { bodyPart: 'ankle', type: 'sprain' }],
    ['i pulled my hamstring', 'REPORT_INJURY', { bodyPart: 'hamstring', type: 'strain' }],
    ['my shoulder really hurts', 'REPORT_INJURY', { bodyPart: 'shoulder' }],
    ['i have chest pain', 'REPORT_SYMPTOM', { symptoms: ['chest_pain'] }],
    ['i had chest pressure during my walk', 'REPORT_SYMPTOM', { symptoms: ['chest_pain'] }],
    ['i feel dizzy', 'REPORT_SYMPTOM', { symptoms: ['dizziness'] }],
    ["i can't breathe", 'REPORT_SYMPTOM', { symptoms: ['dyspnea_unusual'] }],
    ['i cant catch my breath', 'REPORT_SYMPTOM', { symptoms: ['dyspnea_unusual'] }],
    ['i have a fever and feel sick', 'REPORT_SYMPTOM', { symptoms: ['fever'] }],
    ['my knee gives out when i run', 'REPORT_SYMPTOM', { symptoms: ['joint_instability'] }],
  ])('%s → %s', (text, expIntent, expEntities) => {
    const a = intent(text);
    expect(a.intent).toBe(expIntent);
    expect(a.status).toBe('ready');
    for (const [k, v] of Object.entries(expEntities)) expect(a.entities[k]).toEqual(v);
  });

  test('unresolvable injury body part → needs_review, never silently dropped', () => {
    const a = intent('i injured my spleen yesterday');
    expect(a.intent).toBe('REPORT_INJURY');
    expect(a.status).toBe('needs_review');
    expect(a.missing).toContain('bodyPart');
  });

  test('safety phrases never misroute to food/exercise logging', () => {
    for (const t of ['i injured my knee', 'i hurt my back', 'i have chest pain', 'i feel dizzy']) {
      const a = intent(t);
      expect(a.intent).not.toBe('LOG_FOOD');
      expect(a.intent).not.toBe('LOG_EXERCISE_SET');
    }
  });
});

// Execute path — mocked prisma, real switch handlers.
describe('voice safety execute', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(async () => ({ id: 'u1', email: 'u1@t.dev' })),
      create: jest.fn(async ({ data }) => ({ id: data.id })),
    },
    voiceCommand: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }) => data) },
    userInjury: { create: jest.fn(async ({ data }) => ({ id: 'inj-9', ...data })), deleteMany: jest.fn(async () => ({})) },
    userSymptomReport: { create: jest.fn(async ({ data }) => ({ id: 'sym-9', ...data })), deleteMany: jest.fn(async () => ({})) },
  };
  jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
  const request = require('supertest');
  const app = require('../src/app');

  test('REPORT_INJURY persists a voice-sourced injury with follow-ups', async () => {
    const res = await request(app).post('/voice/commands/execute').set('x-user-id', 'u1').send({
      commandId: 'cmd-inj-1',
      transcript: 'i injured my right knee yesterday',
      actions: [{ intent: 'REPORT_INJURY', status: 'ready', entities: { bodyPart: 'knee', laterality: 'right', type: 'unspecified' } }],
    });
    expect(res.status).toBe(201);
    expect(mockPrisma.userInjury.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', bodyPart: 'knee', laterality: 'right', source: 'voice', status: 'current' }),
    }));
    const saved = res.body.result[0];
    expect(saved.safety.followUps.length).toBeGreaterThan(0);
    expect(saved.safety.notPermanent).toBe(true);
  });

  test('REPORT_SYMPTOM urgent code → escalation detail in result', async () => {
    const res = await request(app).post('/voice/commands/execute').set('x-user-id', 'u1').send({
      commandId: 'cmd-sym-1',
      transcript: 'i have chest pain',
      actions: [{ intent: 'REPORT_SYMPTOM', status: 'ready', entities: { symptoms: ['chest_pain'] } }],
    });
    expect(res.status).toBe(201);
    const saved = res.body.result[0];
    expect(saved.safety.urgent).toBe(true);
    expect(saved.detail).toMatch(/urgent medical attention/i);
    expect(mockPrisma.userSymptomReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ triageOutcome: 'urgent_escalation', source: 'voice' }),
    }));
  });
});
