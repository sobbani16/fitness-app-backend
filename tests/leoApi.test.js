// /leo/* API contract tests — sessions, idempotent create/send, tool execution
// through the registry, confirmation issue/confirm flow, owner scoping.
const request = require('supertest');

// In-memory store faking the prisma models /leo touches.
const store = { sessions: [], messages: [], confirmations: [], foodLogs: [] };
const uid = () => `id-${Math.random().toString(36).slice(2, 10)}`;
const canonHash = require('../src/services/leo/confirmations').argsHash;

const mockPrisma = {
  leoSession: {
    create: async ({ data }) => {
      if (data.clientRef && store.sessions.some(s => s.userId === data.userId && s.clientRef === data.clientRef)) {
        const e = new Error('unique'); e.code = 'P2002'; throw e;
      }
      const row = { id: uid(), status: 'active', createdAt: new Date(), ...data };
      store.sessions.push(row); return row;
    },
    findUnique: async ({ where }) => store.sessions.find(s =>
      where.id === s.id || (where.userId_clientRef && s.userId === where.userId_clientRef.userId && s.clientRef === where.userId_clientRef.clientRef)) || null,
    findFirst: async ({ where }) => store.sessions.find(s => s.id === where.id && (!where.userId || s.userId === where.userId)) || null,
    update: async ({ where, data }) => { const s = store.sessions.find(x => x.id === where.id); Object.assign(s, data); return s; },
    updateMany: async ({ where, data }) => {
      const hits = store.sessions.filter(s => s.id === where.id && (!where.userId || s.userId === where.userId) && (!where.status || s.status === where.status));
      hits.forEach(s => Object.assign(s, data)); return { count: hits.length };
    },
    delete: async ({ where }) => { store.sessions = store.sessions.filter(s => s.id !== where.id); return {}; },
  },
  leoMessage: {
    create: async ({ data }) => {
      if (data.clientRef && store.messages.some(m => m.sessionId === data.sessionId && m.clientRef === data.clientRef)) {
        const e = new Error('unique'); e.code = 'P2002'; throw e;
      }
      const row = { id: uid(), createdAt: new Date(), ...data };
      store.messages.push(row); return row;
    },
    findUnique: async ({ where }) => store.messages.find(m =>
      where.sessionId_clientRef && m.sessionId === where.sessionId_clientRef.sessionId && m.clientRef === where.sessionId_clientRef.clientRef) || null,
    findFirst: async ({ where }) => store.messages.find(m => m.sessionId === where.sessionId && (!where.clientRef || m.clientRef === where.clientRef)) || null,
    findMany: async ({ where }) => store.messages.filter(m => m.sessionId === where.sessionId),
    deleteMany: async ({ where }) => { const n = store.messages.length; store.messages = store.messages.filter(m => m.sessionId !== where.sessionId); return { count: n - store.messages.length }; },
  },
  leoConfirmation: {
    create: async ({ data }) => { const row = { id: uid(), consumedAt: null, createdAt: new Date(), ...data }; store.confirmations.push(row); return row; },
    findUnique: async ({ where }) => store.confirmations.find(c => c.id === where.id) || null,
    findFirst: async ({ where }) => store.confirmations.find(c => c.id === where.id && c.userId === where.userId) || null,
    updateMany: async ({ where, data }) => {
      const hits = store.confirmations.filter(c => c.id === where.id && (where.consumedAt === null ? !c.consumedAt : true));
      hits.forEach(c => Object.assign(c, data)); return { count: hits.length };
    },
  },
  foodLog: { findMany: async ({ where }) => store.foodLogs.filter(l => l.userId === where.userId) },
  waterIntake: { aggregate: async () => ({ _sum: { amountMl: 500 } }) },
  dailySteps: { findFirst: async () => ({ steps: 8000 }) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../src/app');
const H = { 'x-user-id': 'u-leo-1' };

beforeEach(() => { store.sessions = []; store.messages = []; store.confirmations = []; store.foodLogs = []; });

describe('/leo sessions + idempotency', () => {
  it('creates a session; clientRef replay is idempotent', async () => {
    const r1 = await request(app).post('/leo/sessions').set(H).send({ clientRef: 's-1' });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/leo/sessions').set(H).send({ clientRef: 's-1' });
    expect(r2.status).toBe(200);
    expect(r2.body.idempotentReplay).toBe(true);
    expect(r2.body.session.id).toBe(r1.body.session.id);
    expect(store.sessions).toHaveLength(1);
  });
  it('sessions are owner-scoped', async () => {
    const r = await request(app).post('/leo/sessions').set(H).send({});
    const other = await request(app).get(`/leo/sessions/${r.body.session.id}`).set('x-user-id', 'intruder');
    expect(other.status).toBe(404);
  });
});

describe('/leo messages + tool execution', () => {
  it('stores a message and returns an honest no-orchestration reply', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    const r = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H).send({ content: 'hello' });
    expect(r.status).toBe(201);
    expect(r.body.reply.role).toBe('assistant');
    expect(r.body.reply.content).toMatch(/toolCall/);
  });
  it('toolCall executes a read tool immediately (no confirmation)', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    const r = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H)
      .send({ toolCall: { name: 'progress.today', args: {} } });
    expect(r.status).toBe(201);
    expect(r.body.toolResult.status).toBe('ok');
    expect(r.body.toolResult.result.waterMl).toBe(500);
  });
  it('message clientRef dedups a retried send', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    await request(app).post(`/leo/sessions/${s.id}/messages`).set(H).send({ content: 'hi', clientRef: 'm-1' });
    const r2 = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H).send({ content: 'hi', clientRef: 'm-1' });
    expect(r2.body.idempotentReplay).toBe(true);
    expect(store.messages.filter(m => m.clientRef === 'm-1')).toHaveLength(1);
  });
  it('identity args in toolCall are rejected (server-bound)', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    const r = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H)
      .send({ toolCall: { name: 'progress.today', args: { userId: 'attacker' } } });
    expect(r.status).toBe(400);
  });
});

describe('confirmation gateway end-to-end', () => {
  const startAndRequestClose = async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    const r = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H)
      .send({ toolCall: { name: 'session.close', args: {} } });
    return { s, r };
  };
  it('sensitive tool → 202 pending_confirmation; confirm executes once', async () => {
    const { s, r } = await startAndRequestClose();
    expect(r.status).toBe(202);
    const cid = r.body.confirmation.id;
    const c1 = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(H).send({ args: {} });
    expect(c1.status).toBe(200);
    expect(c1.body.toolResult.result.closed).toBe(true);
    const c2 = await request(app).post(`/leo/confirmations/${cid}/confirm`).set(H).send({ args: {} });
    expect(c2.status).toBe(409); // replay consumed
  });
  it('confirm with mismatched args → binding mismatch, nothing consumed', async () => {
    const { r } = await startAndRequestClose();
    const c = await request(app).post(`/leo/confirmations/${r.body.confirmation.id}/confirm`).set(H).send({ args: { extra: 'x' } });
    expect(c.status).toBe(409);
  });
  it('cancelled session rejects new messages', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    await request(app).post(`/leo/sessions/${s.id}/cancel`).set(H);
    const r = await request(app).post(`/leo/sessions/${s.id}/messages`).set(H).send({ content: 'hi' });
    expect(r.status).toBe(409);
  });
});

describe('capabilities + history + preferences', () => {
  it('GET /capabilities lists registered tools with categories', async () => {
    const r = await request(app).get('/leo/capabilities').set(H);
    expect(r.status).toBe(200);
    const names = r.body.tools.map(t => t.name);
    expect(names).toContain('progress.today');
    expect(names).toContain('session.close');
    expect(names).toContain('session.purge');
    expect(r.body.contractVersion).toBe('leo-v1');
  });
  it('history returns ordered messages; preferences round-trip', async () => {
    const s = (await request(app).post('/leo/sessions').set(H).send({})).body.session;
    await request(app).post(`/leo/sessions/${s.id}/messages`).set(H).send({ content: 'one' });
    const hist = await request(app).get(`/leo/sessions/${s.id}/messages`).set(H);
    expect(hist.body.messages.length).toBe(2); // user + assistant
    await request(app).put(`/leo/sessions/${s.id}/preferences`).set(H).send({ preferences: { tone: 'brief' } });
    const g = await request(app).get(`/leo/sessions/${s.id}`).set(H);
    expect(g.body.session.preferences).toEqual({ tone: 'brief' });
  });
});
