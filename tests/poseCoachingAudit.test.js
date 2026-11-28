// DEV5 acceptance item (i): audit trail on create/finalize/delete.
// Asserts the exact audit payloads written by the pose-coaching routes —
// actor, action, entityType, entityId — through the real express surface.
const request = require('supertest');
const { envOverrideName } = require('../src/config/featureRegistry');
const flags = require('../src/services/featureFlags/service');

const auditCreates = [];
const store = [];
let idCounter = 0;

const mockPrisma = {
  coachingSession: {
    create: jest.fn(async ({ data }) => {
      idCounter += 1;
      const row = { id: `cs-${idCounter}`, createdAt: new Date(), updatedAt: new Date(), confirmedReps: null, discarded: false, ...data };
      store.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }) =>
      store.find((s) => s.id === where.id
        || (where.userId_clientRef && s.userId === where.userId_clientRef.userId && s.clientRef === where.userId_clientRef.clientRef)) || null),
    update: jest.fn(async ({ where, data }) => {
      const i = store.findIndex((s) => s.id === where.id);
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      store[i] = { ...store[i], ...data };
      return store[i];
    }),
    delete: jest.fn(async ({ where }) => {
      const i = store.findIndex((s) => s.id === where.id);
      if (i < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      store.splice(i, 1);
    }),
    findMany: jest.fn(async () => store),
  },
  user: {
    findUnique: jest.fn(async ({ where }) => ({ id: where.id })),
    create: jest.fn(async ({ data }) => data),
  },
  auditLog: {
    create: jest.fn(async ({ data }) => { auditCreates.push(data); return { id: `al-${auditCreates.length}`, ...data }; }),
  },
  userRole: { findMany: jest.fn(async () => []) },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');

beforeEach(() => {
  jest.clearAllMocks();
  auditCreates.length = 0;
  store.length = 0;
  idCounter = 0;
  process.env[envOverrideName('pose_detection')] = 'true';
  flags.resetCache();
});

const BASE = {
  exerciseId: 'squat',
  startedAt: '2026-01-10T10:00:00Z',
  countedReps: 9,
  consentToStore: true,
};

describe('pose-coaching audit trail (DEV5 item i)', () => {
  test('POST /sessions writes pose_coaching.session_created with actor + entity linkage', async () => {
    const res = await request(app).post('/pose-coaching/sessions').set('x-user-id', 'u1').send(BASE);
    expect(res.status).toBe(201);
    const entry = auditCreates.find((a) => a.action === 'pose_coaching.session_created');
    expect(entry).toBeTruthy();
    expect(entry.actorId).toBe('u1');
    expect(entry.entityType).toBe('CoachingSession');
    expect(entry.entityId).toBe(res.body.session.id);
    expect(entry.afterData).toMatchObject({ exerciseId: 'squat', countedReps: 9 });
  });

  test('non-consent POST writes nothing — no session, no audit entry', async () => {
    const res = await request(app).post('/pose-coaching/sessions').set('x-user-id', 'u1').send({ ...BASE, consentToStore: false });
    expect(res.status).toBe(204);
    expect(store.length).toBe(0);
    expect(auditCreates.length).toBe(0);
  });

  test('PATCH /sessions/:id writes pose_coaching.session_finalized with confirmation outcome', async () => {
    const create = await request(app).post('/pose-coaching/sessions').set('x-user-id', 'u1').send(BASE);
    const id = create.body.session.id;
    auditCreates.length = 0;
    const res = await request(app).patch(`/pose-coaching/sessions/${id}`).set('x-user-id', 'u1').send({ confirmedReps: 8 });
    expect(res.status).toBe(200);
    const entry = auditCreates.find((a) => a.action === 'pose_coaching.session_finalized');
    expect(entry).toBeTruthy();
    expect(entry.actorId).toBe('u1');
    expect(entry.entityType).toBe('CoachingSession');
    expect(entry.entityId).toBe(id);
    expect(entry.afterData).toMatchObject({ confirmedReps: 8, discarded: false });
  });

  test('DELETE /sessions/:id writes pose_coaching.session_deleted even though the record is gone', async () => {
    const create = await request(app).post('/pose-coaching/sessions').set('x-user-id', 'u1').send(BASE);
    const id = create.body.session.id;
    auditCreates.length = 0;
    const res = await request(app).delete(`/pose-coaching/sessions/${id}`).set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(store.find((s) => s.id === id)).toBeUndefined();
    const entry = auditCreates.find((a) => a.action === 'pose_coaching.session_deleted');
    expect(entry).toBeTruthy();
    expect(entry.actorId).toBe('u1');
    expect(entry.entityType).toBe('CoachingSession');
    expect(entry.entityId).toBe(id);
  });

  test('cross-account finalize/delete attempts produce NO audit entries for the victim session', async () => {
    const create = await request(app).post('/pose-coaching/sessions').set('x-user-id', 'u1').send(BASE);
    const id = create.body.session.id;
    auditCreates.length = 0;
    const patch = await request(app).patch(`/pose-coaching/sessions/${id}`).set('x-user-id', 'attacker').send({ confirmedReps: 0 });
    expect(patch.status).toBe(404);
    const del = await request(app).delete(`/pose-coaching/sessions/${id}`).set('x-user-id', 'attacker').send();
    expect(del.status).toBe(404);
    expect(auditCreates.filter((a) => a.entityId === id).length).toBe(0);
    expect(store.find((s) => s.id === id)).toBeTruthy();
  });
});
