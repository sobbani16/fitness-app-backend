process.env.AUTH_TEST_BYPASS = 'false'; // exercise the real authenticate + view-as path
const request = require('supertest');

const mockPrisma = {
  userRole: { findMany: jest.fn(), findFirst: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../src/services/authService', () => ({
  ...jest.requireActual('../src/services/authService'),
  authenticate: jest.fn(),
}));
jest.mock('../src/services/authEmail', () => ({ startEmailWorker: () => () => {} }));
const { authenticate } = require('../src/services/authService');
const app = require('../src/app');

const ADMIN = 'admin-1';
const TARGET = 'user-9';

const SUPER_ROLE_ROWS = (userId) => [{
  userId, active: true,
  role: { name: 'SUPER_ADMIN', rolePermissions: [{ permission: { name: 'SUPER_ADMIN_PANEL' } }] },
}];

beforeEach(() => {
  jest.clearAllMocks();
  authenticate.mockResolvedValue(ADMIN);
  // requireVerifiedEmail reads the user row
  mockPrisma.user.findUnique.mockImplementation(async ({ where }) =>
    where.id === TARGET
      ? { id: TARGET, email: 'member@x.com', firstName: 'Test', lastName: 'Member', emailVerifiedAt: new Date() }
      : { id: where.id || ADMIN, email: 'admin@x.com', emailVerifiedAt: new Date() });
  mockPrisma.userRole.findMany.mockImplementation(async ({ where }) => (where.userId === ADMIN ? SUPER_ROLE_ROWS(ADMIN) : []));
  mockPrisma.userRole.findFirst.mockImplementation(async ({ where }) =>
    where.userId === ADMIN && where.role?.name === 'SUPER_ADMIN' ? { id: 'ur1' } : null);
  mockPrisma.auditLog.create.mockResolvedValue({});
});

async function issueToken(body) {
  const res = await request(app).post('/admin/view-as').set('authorization', 'Bearer t').send(body);
  return res;
}

describe('POST /admin/view-as', () => {
  it('issues a token for a userId target and audit-logs it', async () => {
    const res = await issueToken({ userId: TARGET });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(res.body.subject.userId).toBe(TARGET);
    expect(res.body.subject.email).toBe('member@x.com');
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('issues a role-preview token', async () => {
    const res = await issueToken({ role: 'TRAINER' });
    expect(res.status).toBe(201);
    expect(res.body.subject.role).toBe('TRAINER');
  });

  it('rejects unknown role / missing target / non-super-admin', async () => {
    expect((await issueToken({ role: 'NOPE' })).status).toBe(400);
    expect((await issueToken({})).status).toBe(400);
    mockPrisma.userRole.findMany.mockResolvedValue([]); // member perms only
    expect((await issueToken({ userId: TARGET })).status).toBe(403);
  });
});

describe('view-as token behavior', () => {
  it('user impersonation swaps identity end-to-end on /me/roles', async () => {
    const { body: issued } = await issueToken({ userId: TARGET });
    mockPrisma.userRole.findMany.mockImplementation(async ({ where }) =>
      where.userId === TARGET ? [{ userId: TARGET, active: true, role: { name: 'MEMBER', rolePermissions: [{ permission: { name: 'LOG_MEALS' } }] } }] : []);
    const res = await request(app).get('/me/roles').set('authorization', 'Bearer t').set('x-view-as', issued.token);
    expect(res.status).toBe(200);
    expect(res.headers['x-view-as']).toBe('active');
    expect(res.body.roles).toEqual(['MEMBER']);
    expect(res.body.permissions).toEqual(['LOG_MEALS']);
  });

  it('role preview reports the viewed role on /me/roles', async () => {
    const { body: issued } = await issueToken({ role: 'TRAINER' });
    const res = await request(app).get('/me/roles').set('authorization', 'Bearer t').set('x-view-as', issued.token);
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(['TRAINER']);
    expect(res.body.permissions).toContain('VIEW_CLIENTS');
  });

  it('blocks mutations while view-as is active', async () => {
    const { body: issued } = await issueToken({ userId: TARGET });
    const res = await request(app).post('/me/roles').set('authorization', 'Bearer t').set('x-view-as', issued.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it('rejects tampered, foreign, and non-admin tokens', async () => {
    const { body: issued } = await issueToken({ userId: TARGET });
    const tampered = `${issued.token.split('.')[0]}.AAAA${issued.token.split('.')[1].slice(4)}`;
    expect((await request(app).get('/me/roles').set('authorization', 'Bearer t').set('x-view-as', tampered)).status).toBe(403);

    // Token issued to a different admin id than the caller
    authenticate.mockResolvedValue('other-admin');
    expect((await request(app).get('/me/roles').set('authorization', 'Bearer t').set('x-view-as', issued.token)).status).toBe(403);

    // Caller lost SUPER_ADMIN since issuance
    authenticate.mockResolvedValue(ADMIN);
    mockPrisma.userRole.findFirst.mockResolvedValue(null);
    expect((await request(app).get('/me/roles').set('authorization', 'Bearer t').set('x-view-as', issued.token)).status).toBe(403);
  });
});

describe('GET /admin/view-as/users', () => {
  it('returns matching users with roles', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{
      id: TARGET, email: 'member@x.com', firstName: 'Test', lastName: 'Member',
      userRoles: [{ role: { name: 'MEMBER' } }], trainerProfile: null,
    }]);
    const res = await request(app).get('/admin/view-as/users?q=member').set('authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.users[0]).toMatchObject({ id: TARGET, email: 'member@x.com', name: 'Test Member', roles: ['MEMBER'] });
    const args = mockPrisma.user.findMany.mock.calls[0][0];
    expect(args.take).toBe(10);
    expect(args.where.OR.length).toBe(3);
  });
});
