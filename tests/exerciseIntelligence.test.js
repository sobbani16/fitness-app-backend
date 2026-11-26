// Exercise intelligence read APIs — spec §27 verification (pc-HUM-108).
const request = require('supertest');

const mockPrisma = {
  exerciseIntelligenceProfile: { findMany: jest.fn() },
  exercise: { findMany: jest.fn() },
  userRole: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');

const SQUAT_PROFILE = {
  id: 'p-1', exerciseId: 'ex-squat', version: 1, movementFamily: 'squat',
  secondaryFamilies: '["compound_full_body"]', movementSubtype: 'barbell',
  trackingMethod: 'rep_counter_fsm', coachingCapability: 'basic',
  capabilities: JSON.stringify({
    repCounting: { status: 'validated', engine: 'rep-counter-fsm', engineVersion: '1' },
    formObservation: { status: 'draft' },
    inventedCapability: { status: 'validated' },
  }),
  status: 'validated',
};

function mockRoles(userId, roleNames) {
  mockPrisma.userRole.findMany.mockImplementation(async ({ where }) =>
    where.userId === userId ? roleNames.map((name) => ({ userId, active: true, role: { name } })) : []);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
  mockPrisma.userRole.findMany.mockResolvedValue([]);
  mockPrisma.exerciseIntelligenceProfile.findMany.mockResolvedValue([SQUAT_PROFILE]);
  mockPrisma.exercise.findMany.mockResolvedValue([{ id: 'ex-squat', normalizedName: 'squat', reviewStatus: 'published' }]);
});

describe('profile retrieval', () => {
  it('serves latest-version profiles with validated-only active capabilities', async () => {
    const res = await request(app).get('/exercise-intelligence/profiles').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.profiles).toHaveLength(1);
    const p = res.body.profiles[0];
    expect(p.movementFamily).toBe('squat');
    expect(p.capabilities.repCounting).toMatchObject({ active: true, engine: 'rep-counter-fsm' });
    expect(p.capabilities.formObservation.active).toBe(false);
    expect(p.capabilities).not.toHaveProperty('inventedCapability');
  });

  it('latest version wins per exercise', async () => {
    const v2 = { ...SQUAT_PROFILE, id: 'p-2', version: 2, movementFamily: 'hip_hinge' };
    mockPrisma.exerciseIntelligenceProfile.findMany.mockResolvedValue([v2, SQUAT_PROFILE]);
    const res = await request(app).get('/exercise-intelligence/profiles/ex-squat').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.profile.version).toBe(2);
    expect(res.body.profile.movementFamily).toBe('hip_hinge');
  });

  it('404s when no profile exists', async () => {
    mockPrisma.exerciseIntelligenceProfile.findMany.mockResolvedValue([]);
    const res = await request(app).get('/exercise-intelligence/profiles/ex-missing').set('x-user-id', 'u-1');
    expect(res.status).toBe(404);
  });

  it('hides draft profiles from ordinary reads', async () => {
    const res = await request(app).get('/exercise-intelligence/profiles').set('x-user-id', 'u-1');
    expect(mockPrisma.exerciseIntelligenceProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['validated', 'disabled'] } }),
    }));
    expect(res.status).toBe(200);
  });
});

describe('movement families + model metadata', () => {
  it('serves the canonical spec registry', async () => {
    const res = await request(app).get('/exercise-intelligence/movement-families').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.families.lower_body).toContain('squat');
    expect(res.body.families.core).toContain('anti_rotation');
    expect(res.body.families).not.toHaveProperty('equipment');
  });

  it('model metadata is honest — rule-based FSM, zero fabricated ML artifacts', async () => {
    const res = await request(app).get('/exercise-intelligence/model-metadata').set('x-user-id', 'u-1');
    expect(res.status).toBe(200);
    expect(res.body.poseMlModels).toEqual([]);
    expect(res.body.models[0].kind).toBe('rule_based_fsm');
    expect(res.body.models[0].artifactChecksum).toBeNull();
  });
});

describe('admin coverage', () => {
  it('rejects non-admin users', async () => {
    const res = await request(app).get('/exercise-intelligence/admin/coverage').set('x-user-id', 'u-1');
    expect([401, 403]).toContain(res.status);
  });

  it('reports gaps for admins — missing profiles enumerated', async () => {
    mockRoles('admin-1', ['ADMIN']);
    mockPrisma.exercise.findMany.mockResolvedValue([
      { id: 'ex-squat', normalizedName: 'squat', reviewStatus: 'published' },
      { id: 'ex-curl', normalizedName: 'curl', reviewStatus: 'published' },
    ]);
    const res = await request(app).get('/exercise-intelligence/admin/coverage').set('x-user-id', 'admin-1');
    expect(res.status).toBe(200);
    expect(res.body.totalExercises).toBe(2);
    expect(res.body.missingProfileExerciseIds).toContain('ex-curl');
    expect(res.body.coverageComplete).toBe(false);
  });

  it('coverageComplete only when every exercise is classified with a valid family', async () => {
    mockRoles('admin-1', ['ADMIN']);
    const res = await request(app).get('/exercise-intelligence/admin/coverage').set('x-user-id', 'admin-1');
    expect(res.status).toBe(200);
    expect(res.body.coverageComplete).toBe(true);
  });
});

describe('no mutation surface', () => {
  it.each(['post', 'patch', 'put', 'delete'])('%s on /profiles has no route', async (method) => {
    const res = await request(app)[method]('/exercise-intelligence/profiles').set('x-user-id', 'u-1').send({});
    expect([404, 405]).toContain(res.status);
  });
});
