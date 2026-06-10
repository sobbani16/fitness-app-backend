const request = require('supertest');

const mockPrisma = {
  userRole: { findMany: jest.fn() },
  role: { findUnique: jest.fn(), upsert: jest.fn() },
  permission: { findUnique: jest.fn() },
  rolePermission: { upsert: jest.fn() },
  trainerProfile: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  trainerClient: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn(), update: jest.fn() },
  nutritionistProfile: { findMany: jest.fn(), findUnique: jest.fn() },
  nutritionistClient: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn() },
  workoutPlan: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  mealPlan: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  coachNote: { create: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn(), findMany: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');

function mockRoles(userId, roleNames) {
  mockPrisma.userRole.findMany.mockImplementation(async ({ where, include }) => {
    if (where.userId !== userId) return [];
    return roleNames.map((name) => ({
      userId,
      active: true,
      role: {
        name,
        rolePermissions: include?.role?.include?.rolePermissions
          ? ROLE_PERMS[name] || []
          : undefined,
      },
    }));
  });
}

// Simplified permission map for tests
const ROLE_PERMS = {
  MEMBER: [
    { permission: { name: 'VIEW_OWN_PROFILE' } },
    { permission: { name: 'LOG_MEALS' } },
  ],
  TRAINER: [
    { permission: { name: 'VIEW_CLIENTS' } },
    { permission: { name: 'CREATE_WORKOUT_PLAN' } },
    { permission: { name: 'CREATE_COACH_NOTES' } },
    { permission: { name: 'ASSIGN_CLIENTS' } },
    { permission: { name: 'VIEW_OWN_PROFILE' } },
  ],
  NUTRITIONIST: [
    { permission: { name: 'ASSIGN_MEAL_PLAN' } },
    { permission: { name: 'VIEW_CLIENTS' } },
    { permission: { name: 'CREATE_COACH_NOTES' } },
    { permission: { name: 'VIEW_OWN_PROFILE' } },
  ],
  ADMIN: [
    { permission: { name: 'MANAGE_USERS' } },
    { permission: { name: 'MANAGE_ROLES' } },
    { permission: { name: 'MANAGE_TRAINERS' } },
    { permission: { name: 'VIEW_PLATFORM_ANALYTICS' } },
    { permission: { name: 'VIEW_AUDIT_LOGS' } },
  ],
  SUPER_ADMIN: [
    { permission: { name: 'MANAGE_USERS' } },
    { permission: { name: 'MANAGE_ROLES' } },
    { permission: { name: 'VIEW_AUDIT_LOGS' } },
    { permission: { name: 'MANAGE_SUPER_ADMINS' } },
    { permission: { name: 'MANAGE_TRAINERS' } },
    { permission: { name: 'VIEW_PLATFORM_ANALYTICS' } },
  ],
};

beforeEach(() => jest.clearAllMocks());

// ============================================================================
// RBAC ACCESS CONTROL
// ============================================================================

describe('RBAC — Role-based access control', () => {
  it('returns 401 without x-user-id', async () => {
    const res = await request(app).get('/trainers/me/clients');
    expect(res.status).toBe(401);
  });

  it('returns 403 when MEMBER tries to access trainer routes', async () => {
    mockRoles('member-1', ['MEMBER']);
    const res = await request(app)
      .get('/trainers/me/clients')
      .set('x-user-id', 'member-1');
    expect(res.status).toBe(403);
  });

  it('allows TRAINER to access /trainers/me/clients', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-1', userId: 'trainer-1' });
    mockPrisma.trainerClient.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/trainers/me/clients')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
  });

  it('MEMBER cannot access admin routes', async () => {
    mockRoles('member-1', ['MEMBER']);
    const res = await request(app)
      .get('/admin/users')
      .set('x-user-id', 'member-1');
    expect(res.status).toBe(403);
  });

  it('TRAINER cannot access admin routes', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    const res = await request(app)
      .get('/admin/users')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(403);
  });

  it('ADMIN can access /admin/users', async () => {
    mockRoles('admin-1', ['ADMIN']);
    mockPrisma.userRole.findMany
      .mockResolvedValueOnce([ // first call: RBAC check
        { userId: 'admin-1', active: true, role: { name: 'ADMIN', rolePermissions: ROLE_PERMS.ADMIN } },
      ])
      .mockResolvedValueOnce([]); // second call: the actual query
    const res = await request(app)
      .get('/admin/users')
      .set('x-user-id', 'admin-1');
    expect(res.status).toBe(200);
  });

  it('MEMBER cannot access audit logs', async () => {
    mockRoles('member-1', ['MEMBER']);
    const res = await request(app)
      .get('/audit-logs')
      .set('x-user-id', 'member-1');
    expect(res.status).toBe(403);
  });

  it('ADMIN can view audit logs', async () => {
    mockRoles('admin-1', ['ADMIN']);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/audit-logs')
      .set('x-user-id', 'admin-1');
    expect(res.status).toBe(200);
  });

  it('NUTRITIONIST cannot create workout plans', async () => {
    mockRoles('nutri-1', ['NUTRITIONIST']);
    const res = await request(app)
      .post('/workout-plans')
      .set('x-user-id', 'nutri-1')
      .send({ clientId: 'c-1', title: 'Test' });
    expect(res.status).toBe(403);
  });

  it('TRAINER cannot create meal plans', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    const res = await request(app)
      .post('/meal-plans')
      .set('x-user-id', 'trainer-1')
      .send({ clientId: 'c-1', caloriesTarget: 2000, proteinTarget: 150 });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// TRAINER OPERATIONS
// ============================================================================

describe('Trainer operations', () => {
  it('creates a workout plan', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-1', userId: 'trainer-1' });
    mockPrisma.workoutPlan.create.mockResolvedValue({
      id: 'wp-1',
      trainerId: 'tp-1',
      clientId: 'c-1',
      title: 'Week 1',
      exercises: [{ exerciseName: 'Squat', sets: 3, reps: 10, order: 0 }],
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/workout-plans')
      .set('x-user-id', 'trainer-1')
      .send({
        clientId: 'c-1',
        title: 'Week 1',
        exercises: [{ exerciseName: 'Squat', sets: 3, reps: 10 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Week 1');
  });

  it('assigns a client', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-1', maxClients: 10 });
    mockPrisma.trainerClient.count.mockResolvedValue(3);
    mockPrisma.trainerClient.upsert.mockResolvedValue({ id: 'tc-1', trainerId: 'tp-1', clientId: 'c-1', status: 'pending' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/trainers/clients/assign')
      .set('x-user-id', 'trainer-1')
      .send({ trainerId: 'tp-1', clientId: 'c-1' });
    expect(res.status).toBe(201);
  });
});

// ============================================================================
// NUTRITIONIST OPERATIONS
// ============================================================================

describe('Nutritionist operations', () => {
  it('creates a meal plan', async () => {
    mockRoles('nutri-1', ['NUTRITIONIST']);
    mockPrisma.nutritionistProfile.findUnique.mockResolvedValue({ id: 'np-1', userId: 'nutri-1' });
    mockPrisma.mealPlan.create.mockResolvedValue({
      id: 'mp-1',
      nutritionistId: 'np-1',
      clientId: 'c-1',
      caloriesTarget: 2000,
      proteinTarget: 150,
      items: [{ foodName: 'Chicken', mealType: 'lunch', quantityG: 200 }],
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/meal-plans')
      .set('x-user-id', 'nutri-1')
      .send({
        clientId: 'c-1',
        caloriesTarget: 2000,
        proteinTarget: 150,
        items: [{ foodName: 'Chicken', mealType: 'lunch', quantityG: 200 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.caloriesTarget).toBe(2000);
  });
});

// ============================================================================
// COACH NOTES
// ============================================================================

describe('Coach notes', () => {
  it('trainer can create a note', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-1' });
    mockPrisma.nutritionistProfile.findUnique.mockResolvedValue(null);
    mockPrisma.coachNote.create.mockResolvedValue({ id: 'cn-1', note: 'Good progress', visibility: 'private' });

    const res = await request(app)
      .post('/coach-notes')
      .set('x-user-id', 'trainer-1')
      .send({ clientId: 'c-1', note: 'Good progress' });
    expect(res.status).toBe(201);
  });
});
