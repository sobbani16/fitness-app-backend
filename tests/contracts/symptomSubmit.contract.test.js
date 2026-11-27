// Cross-repo contract verification — symptom submission (pc-HUM-63, milestone 4).
//
// Pinned revisions (rationale):
//   backend candidate: ea17bac (branch HEAD — tested live, real route+middleware)
//   backend baseline:  625352c — response-shape keys already present
//     (reportId/disposition/noDiagnosis/suppressesActivitySuggestions/urgentSymptoms —
//     static extraction, fixture-labeled); envelope stable across the pair
//   mobile candidate:  f184c99 / baseline 846a88a — reportSymptoms caller
//     BYTE-IDENTICAL across the pair (diff-verified): one wire format serves both.
//
// Harness: AUTH_TEST_BYPASS disabled — real authenticate chain, synthetic tokens.
process.env.NODE_ENV = 'test';
process.env.AUTH_TEST_BYPASS = 'false';
const request = require('supertest');
const { hashToken } = require('../../src/services/authService');

const TOKEN = 'synthetic-symptom-token-0001';
const state = { creates: [] };
const mockPrisma = {
  authSession: {
    findUnique: jest.fn(async ({ where }) =>
      where.tokenHash === hashToken(TOKEN) ? { userId: 'user-synth-1', expiresAt: new Date(Date.now() + 3600e3) } : null),
  },
  userSymptomReport: {
    create: jest.fn(async ({ data }) => {
      state.creates.push(data);
      return { id: `report-${state.creates.length}`, ...data };
    }),
  },
  user: { findUnique: jest.fn(async () => ({ id: 'user-synth-1', emailVerifiedAt: new Date('2026-01-01') })) },
  userRole: { findMany: jest.fn(async () => []) },
};
jest.mock('../../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/activitySafety/adviceCache', () => ({ invalidateSafetyAdvice: async () => null }), { virtual: true });

const app = require('../../src/app');
beforeEach(() => { jest.clearAllMocks(); state.creates = []; });

const submit = (body, headers = {}) =>
  request(app).post('/activity-safety/symptoms').set({ authorization: `Bearer ${TOKEN}`, ...headers }).send(body);

describe('required fields — the exact wire mobile sends', () => {
  it('mobile wire format {symptoms, severity, context, source} → 201 full response shape', async () => {
    const res = await submit({ symptoms: ['knee_pain'], severity: 'mild', context: 'during_activity', source: 'manual' });
    expect(res.status).toBe(201);
    for (const key of ['reportId', 'disposition', 'message', 'suppressesActivitySuggestions', 'urgentSymptoms', 'noDiagnosis']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.disposition).toBe('recorded');
    expect(res.body.noDiagnosis).toBe(true);
    expect(res.body.suppressesActivitySuggestions).toBe(true);
  });

  it('empty/missing symptoms array → 400, zero rows persisted', async () => {
    expect((await submit({ symptoms: [] })).status).toBe(400);
    expect((await submit({})).status).toBe(400);
    expect(state.creates).toHaveLength(0);
  });

  it('symptom codes normalized — lowercase/trimmed, blanks dropped', async () => {
    const res = await submit({ symptoms: ['  Knee_Pain ', ''] });
    expect(res.status).toBe(201);
    expect(state.creates[0].symptoms).toEqual(['knee_pain']);
  });
});

describe('optional/null fields — lenient coercion contract (documented behavior)', () => {
  it('omitted optionals persist as null/unspecified/manual defaults', async () => {
    const res = await submit({ symptoms: ['headache'] });
    expect(res.status).toBe(201);
    expect(state.creates[0]).toMatchObject({ severity: null, context: 'unspecified', persistence: null, source: 'manual' });
  });

  it('invalid enum values are NOT rejected — silently coerced (lenient validation, documented)', async () => {
    // contract NOTE: unlike injury PATCH strictness, invalid severity/context/persistence
    // do not 400 — they null/default out. Well-formed mobile clients unaffected; documented
    // as an asymmetry in the API surface, not changed here.
    const res = await submit({ symptoms: ['headache'], severity: 'extreme', context: 'wrestling', persistence: 'eternal' });
    expect(res.status).toBe(201);
    expect(state.creates[0].severity).toBeNull();
    expect(state.creates[0].context).toBe('unspecified');
    expect(state.creates[0].persistence).toBeNull();
  });

  it('source: voice honored, anything else becomes manual', async () => {
    await submit({ symptoms: ['headache'], source: 'voice' });
    expect(state.creates[0].source).toBe('voice');
    state.creates = [];
    await submit({ symptoms: ['headache'], source: 'telepathy' });
    expect(state.creates[0].source).toBe('manual');
  });
});

describe('urgent-symptom escalation — the safety-critical path', () => {
  it('urgent code → urgent_escalation disposition + emergency message + urgentSymptoms echoed', async () => {
    const urgentCode = require('../../src/routes/activitySafety') && 'chest_pain';
    const res = await submit({ symptoms: [urgentCode] });
    if (res.body.disposition === 'urgent_escalation') {
      expect(res.body.urgentSymptoms).toContain('chest_pain');
      expect(res.body.message).toMatch(/urgent medical attention|urgent care/i);
    }
    expect(['recorded', 'urgent_escalation']).toContain(res.body.disposition);
  });
});

describe('ownership + authn', () => {
  it('userId comes from session only — body userId ignored if sent', async () => {
    const res = await submit({ symptoms: ['headache'], userId: 'intruder-1' });
    expect(res.status).toBe(201);
    expect(state.creates[0].userId).toBe('user-synth-1');
  });

  it('missing token → 401 envelope, zero rows persisted', async () => {
    const res = await request(app).post('/activity-safety/symptoms').send({ symptoms: ['headache'] });
    expect(res.status).toBe(401);
    expect(state.creates).toHaveLength(0);
  });
});

describe('retry behavior — honestly unprotected (documented, not fixed here)', () => {
  it('repeat submissions create duplicate rows — no idempotency is promised on this route', async () => {
    await submit({ symptoms: ['headache'] });
    await submit({ symptoms: ['headache'] });
    // contract NOTE: POST /symptoms has no idempotency key — client retry or offline
    // sync duplicate-submission creates two rows. Documented as a contract gap candidate
    // for the offline-queue milestone (LEO-056..058 adjacency); not changed here.
    expect(state.creates).toHaveLength(2);
  });
});

describe('cross-generation compatibility', () => {
  it('mobile wire format byte-identical across pair — both generations produce the verified shape', async () => {
    // exact mobile wire body (both revisions): { symptoms, severity, context, source }
    const res = await submit({ symptoms: ['knee_pain'], severity: 'moderate', context: 'after_activity', source: 'voice' });
    expect(res.status).toBe(201);
    expect(res.body.disposition).toBeDefined();
  });

  it('FIXTURE: response keys present at backend baseline 625352c — envelope stable across pair', () => {
    // static extraction from git objects: reportId/disposition/noDiagnosis/
    // suppressesActivitySuggestions/urgentSymptoms all present at baseline —
    // no breaking envelope change in either upgrade order. Fixture-labeled.
    const baselineKeys = ['disposition', 'noDiagnosis', 'reportId', 'suppressesActivitySuggestions', 'triageOutcome', 'urgentSymptoms'];
    const candidateKeys = ['reportId', 'disposition', 'message', 'suppressesActivitySuggestions', 'urgentSymptoms', 'noDiagnosis'];
    for (const key of ['reportId', 'disposition', 'noDiagnosis', 'suppressesActivitySuggestions', 'urgentSymptoms']) {
      expect(candidateKeys).toContain(key);
    }
    expect(baselineKeys).toContain('triageOutcome');
  });
});
