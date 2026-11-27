// HUM-110: registry HTTP surface — admin-only writes, authenticated reads.
const request = require('supertest');
const express = require('express');

jest.mock('../src/services/pose/modelRegistry', () => ({
  registerModel: jest.fn(async (p, data) => ({ id: 'm1', status: 'registered', ...data })),
  transition: jest.fn(async (p, id, to) => ({ id, status: to })),
  rollback: jest.fn(async (p, id) => ({ id, status: 'rolled_back' })),
  setExerciseEnabled: jest.fn(async (p, id, ex, enabled) => ({ id, capabilities: { [ex]: enabled } })),
  activeManifest: jest.fn(async () => ({ squat: { modelId: 'm1', checksum: 'abc' } })),
  TRANSITIONS: {},
}));

const roles = [];
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    userRole: { findMany: async () => roles.map((name) => ({ role: { name } })) },
  }),
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = req.headers['x-user-id'] || null; next(); });
app.use('/pose-models', require('../src/routes/poseModels'));

beforeEach(() => { roles.length = 0; });

describe('registry HTTP surface authz', () => {
  it('manifest is readable by any authenticated user', async () => {
    const r = await request(app).get('/pose-models/manifest').set('x-user-id', 'user-1');
    expect(r.status).toBe(200);
    expect(r.body.manifest.squat.modelId).toBe('m1');
  });

  it('registration is 403 for non-admin', async () => {
    const r = await request(app).post('/pose-models').set('x-user-id', 'user-1').send({ exerciseId: 'squat' });
    expect(r.status).toBe(403);
  });

  it('registration succeeds for admin — 201', async () => {
    roles.push('ADMIN');
    const r = await request(app).post('/pose-models').set('x-user-id', 'admin-1').send({ exerciseId: 'squat', architecture: 'tcn' });
    expect(r.status).toBe(201);
    expect(r.body.model.id).toBe('m1');
  });

  it('transition passes actor identity from the authenticated admin', async () => {
    roles.push('ADMIN');
    const reg = require('../src/services/pose/modelRegistry');
    await request(app).post('/pose-models/m1/transition').set('x-user-id', 'admin-9').send({ to: 'candidate', reason: 'eval passed' });
    const call = reg.transition.mock.calls[0];
    expect(call[2]).toBe('candidate');
    expect(call[3].actor).toBe('admin-9');
    expect(call[3].reason).toBe('eval passed');
  });

  it('rollback and capability toggle are admin-only', async () => {
    const rb = await request(app).post('/pose-models/m1/rollback').set('x-user-id', 'user-1').send({});
    expect(rb.status).toBe(403);
    const pt = await request(app).patch('/pose-models/m1/exercises/squat').set('x-user-id', 'user-1').send({ enabled: false });
    expect(pt.status).toBe(403);
    roles.push('ADMIN');
    const rb2 = await request(app).post('/pose-models/m1/rollback').set('x-user-id', 'admin-1').send({ reason: 'regression' });
    expect(rb2.status).toBe(200);
  });

  it('service errors map to their status codes', async () => {
    roles.push('ADMIN');
    const reg = require('../src/services/pose/modelRegistry');
    reg.transition.mockImplementationOnce(async () => { throw Object.assign(new Error('beats_baseline_required'), { status: 409 }); });
    const r = await request(app).post('/pose-models/m1/transition').set('x-user-id', 'admin-1').send({ to: 'approved' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('beats_baseline_required');
  });
});
