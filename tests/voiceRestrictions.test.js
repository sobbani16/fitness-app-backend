// HUM-42 §2.5 — voice restriction intents: "I injured my knee" (existing),
// "don't recommend running", "my doctor told me not to lift heavy", "show my
// restrictions". Contracts: ambiguity clarifies BEFORE persisting; execution
// requires the confirm round-trip (only ready actions execute); a doctor
// mention is never clinician provenance; never diagnoses or clearance.
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => false }));
const { parseTranscript } = require('../src/services/voice/voiceParser');

// Fully mocked prisma — stateful restriction store, matching the card's
// restrictionManagement harness (the DB-backed voice suite is inoperable in
// this worktree: fitness_test carries no schema — pre-existing, recorded).
const store = { restrictions: [], commands: [] };
const rid = () => `vr-${Math.random().toString(36).slice(2, 9)}`;
const mockPrisma = {
  userActivityRestriction: {
    create: jest.fn(async ({ data }) => {
      const row = { id: rid(), status: 'active', createdAt: new Date(), updatedAt: new Date(), clinicianNote: null, ...data };
      store.restrictions.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where } = {}) => store.restrictions.filter((r) =>
      r.userId === where?.userId && (!where?.status || r.status === where.status))),
    deleteMany: jest.fn(async ({ where }) => {
      const before = store.restrictions.length;
      store.restrictions = store.restrictions.filter((r) => !(r.id === where?.id && (!where?.userId || r.userId === where.userId)));
      return { count: before - store.restrictions.length };
    }),
    count: jest.fn(async ({ where } = {}) => store.restrictions.filter((r) => !where?.userId || r.userId === where.userId).length),
  },
  voiceCommand: {
    findUnique: jest.fn(async ({ where }) => store.commands.find((c) => c.id === where?.id) || null),
    create: jest.fn(async ({ data }) => { const row = { createdAt: new Date(), ...data }; store.commands.push(row); return row; }),
    update: jest.fn(async ({ where, data }) => {
      const i = store.commands.findIndex((c) => c.id === where.id);
      if (i >= 0) store.commands[i] = { ...store.commands[i], ...data };
      return store.commands[i];
    }),
  },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/featureFlags/service', () => ({ isEnabled: jest.fn(async () => true) }));
jest.mock('../src/services/activitySafety/recommendationSafety', () => ({
  invalidateSafetyAdvice: jest.fn(async () => {}),
  freshSafetyRecommendations: jest.fn(async () => null),
}));

const app = express();
app.use(express.json());
app.use('/voice', require('../src/routes/voice'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const U = 'voice-restr-u';
const H = { 'x-user-id': U };

beforeEach(() => { store.restrictions.length = 0; store.commands.length = 0; jest.clearAllMocks(); });

// helper standing in for prisma queries the tests assert against
const prisma = {
  userActivityRestriction: {
    count: async ({ where } = {}) => store.restrictions.filter((r) => !where?.userId || r.userId === where.userId).length,
    findMany: async ({ where } = {}) => store.restrictions.filter((r) => r.userId === where?.userId),
    create: async ({ data }) => mockPrisma.userActivityRestriction.create({ data }),
    deleteMany: async ({ where } = {}) => mockPrisma.userActivityRestriction.deleteMany({ where }),
  },
};

describe('§2.5 parser — restriction intents', () => {
  const intent = t => parseTranscript(t).actions[0];

  test.each([
    ["don't recommend running", 'running', false],
    ['stop suggesting swimming', 'swimming', false],
    ['never recommend hiit', 'hiit', false],
    ['my doctor told me not to lift heavy', 'lift heavy', true],
    ['physio said no running', 'running', true],
    ['my surgeon said I should not jump', 'jump', true],
  ])('%s → CREATE_RESTRICTION', (text, activityText, clinician) => {
    const a = intent(text);
    expect(a.intent).toBe('CREATE_RESTRICTION');
    expect(a.entities.activityText).toBe(activityText);
    expect(a.entities.clinicianMentioned).toBe(clinician);
  });

  test.each(['show my restrictions', 'what restrictions do I have', 'list my restrictions'])('%s → SHOW_RESTRICTIONS read-only', (text) => {
    const a = intent(text);
    expect(a.intent).toBe('SHOW_RESTRICTIONS');
    expect(a.status).toBe('ready');
  });

  test('restriction phrasing never misroutes to logging intents', () => {
    for (const t of ["don't recommend running", 'my doctor told me not to lift heavy']) {
      expect(intent(t).intent).not.toMatch(/LOG_|MARK_/);
    }
  });
});

describe('§2.5 execute — confirmation-enforced restriction writes', () => {
  test('interpret maps "running" to canonical categories; unknown activity clarifies BEFORE persisting', async () => {
    const ok = await request(app).post('/voice/interpret').set(H).send({ transcript: "don't recommend running" });
    const action = ok.body.actions[0];
    expect(action.intent).toBe('CREATE_RESTRICTION');
    expect(action.status).toBe('ready');
    expect(action.entities.categories).toContain('impact'); // canonical catalog categories
    const bad = await request(app).post('/voice/interpret').set(H).send({ transcript: "don't recommend zumbaliciousness" });
    const badAction = bad.body.actions[0];
    expect(badAction.status).toBe('needs_review'); // ambiguity clarifies first
    expect(badAction.missing).toContain('activity');
    // nothing persisted from interpret alone
    expect(await prisma.userActivityRestriction.count({ where: { userId: U } })).toBe(0);
  });

  test('execute writes a user-preference restriction only after confirmation; undo reverses it', async () => {
    const interp = await request(app).post('/voice/interpret').set(H).send({ transcript: "don't recommend running" });
    const commandId = 'vr-cmd-' + Math.random().toString(36).slice(2, 10);
    const exec = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId, transcript: "don't recommend running", actions: interp.body.actions });
    const r = exec.body.result[0];
    expect(r.status).toBe('saved');
    const rows = await prisma.userActivityRestriction.findMany({ where: { userId: U } });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('user_preference');
    expect(rows[0].categories).toContain('impact');
    expect(rows[0].severity).toBe('prohibited');
    // undo reverses the write
    await request(app).post('/voice/commands/undo').set(H).send({ commandId });
    expect(await prisma.userActivityRestriction.count({ where: { userId: U } })).toBe(0);
  });

  test('doctor-phrased voice NEVER becomes clinician_documented — self_reported with honest context', async () => {
    const interp = await request(app).post('/voice/interpret').set(H).send({ transcript: 'my doctor told me not to lift heavy' });
    const commandId = 'vr-cmd-' + Math.random().toString(36).slice(2, 10);
    const exec = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId, transcript: 'my doctor told me not to lift heavy', actions: interp.body.actions });
    expect(exec.body.result[0].status).toBe('saved');
    expect(exec.body.result[0].detail).toMatch(/never medical clearance or diagnosis/);
    const rows = await prisma.userActivityRestriction.findMany({ where: { userId: U } });
    expect(rows[0].source).toBe('self_reported'); // never clinician_documented from voice
    expect(rows[0].reason).toMatch(/unverified, user-reported/);
    expect(rows[0].clinicianNote).toBeNull();
    await prisma.userActivityRestriction.deleteMany({ where: { userId: U } });
  });

  test('needs_review actions NEVER execute — confirmation is structurally required', async () => {
    const interp = await request(app).post('/voice/interpret').set(H).send({ transcript: "don't recommend zumbaliciousness" });
    const commandId = 'vr-cmd-' + Math.random().toString(36).slice(2, 10);
    const exec = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId, transcript: "don't recommend zumbaliciousness", actions: interp.body.actions });
    expect(exec.body.result[0].status).toBe('skipped');
    expect(await prisma.userActivityRestriction.count({ where: { userId: U } })).toBe(0); // zero writes
  });

  test('SHOW_RESTRICTIONS answers read-only with zero writes', async () => {
    await prisma.userActivityRestriction.create({ data: {
      userId: U, categories: ['impact'], bodyRegions: [], severity: 'prohibited', source: 'user_preference', reason: 'test' } });
    const interp = await request(app).post('/voice/interpret').set(H).send({ transcript: 'show my restrictions' });
    const commandId = 'vr-cmd-' + Math.random().toString(36).slice(2, 10);
    const exec = await request(app).post('/voice/commands/execute').set(H)
      .send({ commandId, transcript: 'show my restrictions', actions: interp.body.actions });
    expect(exec.body.result[0].status).toBe('answered');
    expect(exec.body.result[0].detail).toMatch(/1 active restriction/);
    expect(exec.body.result[0].detail).not.toMatch(/cleared|cleareance|healed/i); // never clearance language
    expect(await prisma.userActivityRestriction.count({ where: { userId: U } })).toBe(1); // unchanged
    await prisma.userActivityRestriction.deleteMany({ where: { userId: U } });
  });
});
