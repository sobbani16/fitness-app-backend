// Trainer platform M2–M4: F1 status regression, consent-gated progress,
// request→accept flow, discovery filters/names, applications + admin review,
// granular flag enforcement. Prisma is fully mocked (no DB).
const request = require('supertest');

const mockPrisma = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(async () => 0),
  userRole: { findMany: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  role: { findUnique: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  trainerProfile: {
    findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), upsert: jest.fn(), count: jest.fn(),
  },
  trainerClient: {
    findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    upsert: jest.fn(), count: jest.fn(), update: jest.fn(),
    groupBy: jest.fn(), updateMany: jest.fn(),
  },
  trainerClientConsent: {
    findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(),
    create: jest.fn(), updateMany: jest.fn(),
  },
  trainerCertification: {
    findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(),
    update: jest.fn(), delete: jest.fn(),
  },
  notification: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  authSession: { deleteMany: jest.fn() },
  weightEntry: { findMany: jest.fn() },
  dailyMacroScore: { findMany: jest.fn() },
  workoutSession: { findMany: jest.fn() },
  healthScore: { findMany: jest.fn() },
  dailySteps: { findMany: jest.fn() },
  sleepLog: { findMany: jest.fn() },
};
mockPrisma.$transaction = jest.fn(async (arg) =>
  typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));

const app = require('../src/app');
const flags = require('../src/services/featureFlags/service');
const { envOverrideName } = require('../src/config/featureRegistry');
const setEnv = (key, value) => { process.env[envOverrideName(key)] = value; flags.resetCache(); };
const restore = (key) => setEnv(key, 'true');

const ROLE_PERMS = {
  MEMBER: [{ permission: { name: 'VIEW_OWN_PROFILE' } }],
  TRAINER: [{ permission: { name: 'VIEW_CLIENTS' } }],
  ADMIN: [
    { permission: { name: 'MANAGE_USERS' } },
    { permission: { name: 'MANAGE_ROLES' } },
    { permission: { name: 'MANAGE_TRAINERS' } },
    { permission: { name: 'VIEW_AUDIT_LOGS' } },
  ],
};
function mockRoles(userId, roleNames) {
  mockPrisma.userRole.findMany.mockImplementation(async ({ where, include }) => {
    if (where.userId !== userId) return [];
    return roleNames.map((name) => ({
      userId,
      active: true,
      role: {
        name,
        rolePermissions: include?.role?.include?.rolePermissions ? ROLE_PERMS[name] || [] : undefined,
      },
    }));
  });
}

// Approved, discoverable trainer profile for 'trainer-1'.
const TRAINER = {
  id: 'tp-1', userId: 'trainer-1', verified: true, active: true,
  applicationStatus: 'approved', isDiscoverable: true, tier: 'pro',
  maxClients: 10, specialties: ['strength_training'], languages: ['en'],
  coachingMode: 'both', displayName: null, rating: 4.8, ratingCount: 3,
  location: 'Austin', country: 'US', timeZone: 'America/Chicago',
};

const RELATION = {
  id: 'rel-1', trainerId: 'tp-1', clientId: 'client-1', status: 'active',
  requestedBy: 'client', startedAt: new Date('2026-01-01'), assignedAt: new Date('2026-01-01'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (arg) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg));
  mockPrisma.$executeRaw.mockResolvedValue(0);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({});
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.notification.create.mockResolvedValue({});
  mockPrisma.authSession.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.trainerClientConsent.findMany.mockResolvedValue([]);
  mockPrisma.trainerClientConsent.upsert.mockResolvedValue({});
  mockPrisma.trainerClientConsent.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.trainerClient.groupBy.mockResolvedValue([]);
});

afterEach(() => {
  for (const key of ['trainer_dashboard', 'trainer_discovery', 'trainer_registration', 'trainer_coaching', 'trainer_insights']) restore(key);
});

/** trainerProfile.findUnique dispatch: {userId} → byUser, {id} → byId. */
function mockProfiles({ byUser = {}, byId = {} } = {}) {
  mockPrisma.trainerProfile.findUnique.mockImplementation(async ({ where }) => {
    if (where.userId !== undefined) return byUser[where.userId] || null;
    if (where.id !== undefined) return byId[where.id] || null;
    return null;
  });
}

// ---------------------------------------------------------------------------
// F1: dropped/paused/completed relations lose progress access
// ---------------------------------------------------------------------------
describe('F1 — relation status required for progress', () => {
  beforeEach(() => mockRoles('trainer-1', ['TRAINER']));

  test('dropped relation → 403', async () => {
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    mockPrisma.trainerClient.findUnique.mockResolvedValue({ ...RELATION, status: 'dropped' });
    const res = await request(app)
      .get('/trainers/clients/client-1/progress')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(403);
    expect(mockPrisma.weightEntry.findMany).not.toHaveBeenCalled();
  });

  test('paused relation → 403; pending → 403', async () => {
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    for (const status of ['paused', 'pending', 'completed']) {
      mockPrisma.trainerClient.findUnique.mockResolvedValueOnce({ ...RELATION, status });
      const res = await request(app)
        .get('/trainers/clients/client-1/progress')
        .set('x-user-id', 'trainer-1');
      expect(res.status).toBe(403);
    }
  });

  test('unapproved trainer → 403 even with active relation', async () => {
    mockProfiles({ byUser: { 'trainer-1': { ...TRAINER, applicationStatus: 'submitted' } } });
    const res = await request(app)
      .get('/trainers/clients/client-1/progress')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Consent-gated progress categories
// ---------------------------------------------------------------------------
describe('consent-filtered progress categories', () => {
  beforeEach(() => {
    mockRoles('trainer-1', ['TRAINER']);
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    mockPrisma.trainerClient.findUnique.mockResolvedValue(RELATION);
  });

  test('only granted categories are returned', async () => {
    mockPrisma.trainerClientConsent.findMany.mockResolvedValue([
      { category: 'weight_trends' }, { category: 'sleep_summaries' },
    ]);
    mockPrisma.weightEntry.findMany.mockResolvedValue([{ id: 'w1', weightKg: 80 }]);
    mockPrisma.sleepLog.findMany.mockResolvedValue([{ id: 's1', hoursSlept: 7 }]);
    const res = await request(app)
      .get('/trainers/clients/client-1/progress')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.weight).toHaveLength(1);
    expect(res.body.sleep).toHaveLength(1);
    // Ungranted categories are omitted entirely — no keys, no errors.
    for (const key of ['workoutSessions', 'macroScores', 'healthScores', 'steps']) {
      expect(res.body[key]).toBeUndefined();
    }
    expect(mockPrisma.workoutSession.findMany).not.toHaveBeenCalled();
  });

  test('no consent rows → no data sections', async () => {
    mockPrisma.trainerClientConsent.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/trainers/clients/client-1/progress')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.weight).toBeUndefined();
    expect(res.body.grantedCategories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Subscribe → pending → trainer accept → active
// ---------------------------------------------------------------------------
describe('request → accept → active flow', () => {
  test('subscribe creates pending relation + pending consents, accept activates', async () => {
    // --- client subscribes ---
    mockProfiles({ byId: { 'tp-1': TRAINER } });
    mockPrisma.trainerClient.findFirst.mockResolvedValue(null); // no active, no other pending
    mockPrisma.trainerClient.findUnique.mockResolvedValue(null); // no prior relation
    mockPrisma.trainerClient.count.mockResolvedValue(0);
    mockPrisma.trainerClient.upsert.mockResolvedValue({ ...RELATION, status: 'pending' });

    const sub = await request(app)
      .post('/trainers/tp-1/subscribe')
      .set('x-user-id', 'client-1')
      .send({});
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('pending');
    const create = mockPrisma.trainerClient.upsert.mock.calls[0][0].create;
    expect(create.status).toBe('pending');
    expect(create.requestedBy).toBe('client');
    // Proposed consent set: all 8 categories pending.
    expect(mockPrisma.trainerClientConsent.upsert).toHaveBeenCalledTimes(8);
    for (const call of mockPrisma.trainerClientConsent.upsert.mock.calls) {
      expect(call[0].create.status).toBe('pending');
    }

    // --- trainer accepts ---
    const pending = { ...RELATION, status: 'pending', requestedBy: 'client', trainer: TRAINER };
    mockPrisma.trainerClient.findUnique.mockResolvedValue(pending);
    mockPrisma.trainerClient.update.mockResolvedValue({ ...pending, status: 'active', lockedUntil: new Date() });
    const acc = await request(app)
      .post('/trainer-requests/rel-1/accept')
      .set('x-user-id', 'trainer-1');
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('active');
    expect(acc.body.lockedUntil).toBeTruthy();
    expect(mockPrisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'client-1' }) })
    );
  });

  test('requester cannot self-accept; non-participant gets 403', async () => {
    const pending = { ...RELATION, status: 'pending', requestedBy: 'client', trainer: TRAINER };
    mockPrisma.trainerClient.findUnique.mockResolvedValue(pending);
    const res = await request(app)
      .post('/trainer-requests/rel-1/accept')
      .set('x-user-id', 'client-1'); // requester trying to self-accept
    expect(res.status).toBe(403);
    const res2 = await request(app)
      .post('/trainer-requests/rel-1/accept')
      .set('x-user-id', 'intruder-9');
    expect(res2.status).toBe(403);
  });

  test('decline → dropped; trainer invite is client-accepted', async () => {
    const pending = { ...RELATION, status: 'pending', requestedBy: 'client', trainer: TRAINER };
    mockPrisma.trainerClient.findUnique.mockResolvedValue(pending);
    mockPrisma.trainerClient.update.mockImplementation(async ({ data }) => ({ ...pending, ...data }));
    const dec = await request(app)
      .post('/trainer-requests/rel-1/decline')
      .set('x-user-id', 'trainer-1');
    expect(dec.status).toBe(200);
    expect(dec.body.status).toBe('dropped');
    expect(dec.body.dropReason).toBe('declined');

    // Trainer-initiated invite → the client confirms via the same endpoint.
    const invite = { ...RELATION, status: 'pending', requestedBy: 'trainer', trainer: TRAINER };
    mockPrisma.trainerClient.findUnique.mockResolvedValue(invite);
    mockPrisma.trainerClient.count.mockResolvedValue(0);
    mockPrisma.trainerClient.update.mockResolvedValue({ ...invite, status: 'active' });
    const acc = await request(app)
      .post('/trainer-requests/rel-1/accept')
      .set('x-user-id', 'client-1');
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('active');
  });

  test('trainer pending list requires approved trainer; ?mine=1 shows client requests', async () => {
    // Trainer view
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    mockPrisma.trainerClient.findMany.mockResolvedValue([{ ...RELATION, status: 'pending' }]);
    const res = await request(app).get('/trainer-requests').set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);

    // Client view
    mockPrisma.trainerClient.findMany.mockResolvedValue([{ ...RELATION, status: 'pending', trainer: TRAINER }]);
    const mine = await request(app).get('/trainer-requests?mine=1').set('x-user-id', 'client-1');
    expect(mine.status).toBe(200);
    expect(mine.body.requests).toHaveLength(1);

    // Non-approved user hitting the trainer view → 403
    mockProfiles({ byUser: {} });
    const denied = await request(app).get('/trainer-requests').set('x-user-id', 'rando-1');
    expect(denied.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Consent management + revocation effect
// ---------------------------------------------------------------------------
describe('consent management', () => {
  const relation = { ...RELATION, trainer: TRAINER };

  test('client grants + revokes; trainer cannot write consents', async () => {
    mockPrisma.trainerClient.findUnique.mockResolvedValue(relation);
    mockPrisma.trainerClientConsent.findMany.mockResolvedValue([
      { category: 'weight_trends', status: 'granted', grantedAt: new Date(), revokedAt: null, policyVersion: 'v1' },
      { category: 'workout_records', status: 'revoked', grantedAt: null, revokedAt: new Date(), policyVersion: 'v1' },
    ]);
    const res = await request(app)
      .put('/trainer-relationships/rel-1/consents')
      .set('x-user-id', 'client-1')
      .send({ grants: ['weight_trends'], revokes: ['workout_records'] });
    expect(res.status).toBe(200);
    expect(res.body.consents).toHaveLength(8);
    const byCat = Object.fromEntries(res.body.consents.map((c) => [c.category, c.status]));
    expect(byCat.weight_trends).toBe('granted');
    expect(byCat.workout_records).toBe('revoked');

    // Trainer writing consents → 403
    const denied = await request(app)
      .put('/trainer-relationships/rel-1/consents')
      .set('x-user-id', 'trainer-1')
      .send({ grants: ['weight_trends'] });
    expect(denied.status).toBe(403);

    // Unknown category → 400
    const bad = await request(app)
      .put('/trainer-relationships/rel-1/consents')
      .set('x-user-id', 'client-1')
      .send({ grants: ['bank_passwords'] });
    expect(bad.status).toBe(400);
  });

  test('revoked category disappears from progress', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    // After the client revokes weight_trends, nothing is granted.
    mockPrisma.trainerClient.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'rel-1' ? relation : RELATION);
    mockPrisma.trainerClientConsent.findMany.mockImplementation(async ({ where }) =>
      where.status === 'granted' ? [] : [{ category: 'weight_trends', status: 'revoked' }]);
    const res = await request(app)
      .get('/trainers/clients/client-1/progress')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.weight).toBeUndefined();
    expect(mockPrisma.weightEntry.findMany).not.toHaveBeenCalled();
  });

  test('GET consents returns all 8 categories for participants', async () => {
    mockPrisma.trainerClient.findUnique.mockResolvedValue(relation);
    mockPrisma.trainerClientConsent.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/trainer-relationships/rel-1/consents')
      .set('x-user-id', 'trainer-1');
    expect(res.status).toBe(200);
    expect(res.body.consents).toHaveLength(8);
    expect(res.body.consents.every((c) => c.status === 'pending')).toBe(true);
    const outsider = await request(app)
      .get('/trainer-relationships/rel-1/consents')
      .set('x-user-id', 'nobody-7');
    expect(outsider.status).toBe(403);
  });

  test('end relationship → dropped + all consents revoked', async () => {
    mockPrisma.trainerClient.findUnique.mockResolvedValue(relation);
    mockPrisma.trainerClient.update.mockResolvedValue({ ...relation, status: 'dropped', droppedBy: 'client' });
    const res = await request(app)
      .post('/trainer-relationships/rel-1/end')
      .set('x-user-id', 'client-1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dropped');
    expect(mockPrisma.trainerClientConsent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'revoked' }) })
    );
  });
});

// ---------------------------------------------------------------------------
// Discovery: filters, names, gating
// ---------------------------------------------------------------------------
describe('discovery', () => {
  test('list returns displayName (never raw userId as name) + batched counts', async () => {
    mockPrisma.trainerProfile.findMany.mockResolvedValue([TRAINER]);
    mockPrisma.trainerClient.groupBy.mockResolvedValue([{ trainerId: 'tp-1', _count: { _all: 4 } }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'trainer-1', firstName: 'Terry', lastName: 'Ng' }]);
    const res = await request(app).get('/trainers').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.trainers[0].displayName).toBe('Terry Ng');
    expect(res.body.trainers[0].currentClients).toBe(4);
    expect(res.body.trainers[0].spotsLeft).toBe(6);
    // Approved + discoverable gate baked into the query.
    const where = mockPrisma.trainerProfile.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ verified: true, active: true, applicationStatus: 'approved', isDiscoverable: true });
    // F8: groupBy used instead of per-trainer count.
    expect(mockPrisma.trainerClient.groupBy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.trainerClient.count).not.toHaveBeenCalled();
  });

  test('filters q/specialty/mode/language/country + cursor reach the query', async () => {
    mockPrisma.trainerProfile.findMany.mockResolvedValue([]);
    const res = await request(app)
      .get('/trainers?q=aust&specialty=Yoga&mode=online&language=es&country=us&cursor=tp-9&take=10')
      .set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    const args = mockPrisma.trainerProfile.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { displayName: { contains: 'aust', mode: 'insensitive' } },
      { location: { contains: 'aust', mode: 'insensitive' } },
    ]);
    expect(args.where.specialties.hasSome).toEqual(expect.arrayContaining(['yoga', 'Yoga']));
    expect(args.where.coachingMode).toEqual({ in: ['online', 'both'] });
    expect(args.where.languages).toEqual({ has: 'es' });
    expect(args.where.country).toEqual({ equals: 'us', mode: 'insensitive' });
    expect(args.cursor).toEqual({ id: 'tp-9' });
    expect(args.skip).toBe(1);
  });

  test('non-approved / non-discoverable profile detail → 404', async () => {
    mockPrisma.trainerProfile.findFirst.mockResolvedValue(null); // filtered out by query
    const res = await request(app).get('/trainers/tp-1').set('x-user-id', 'u1');
    expect(res.status).toBe(404);
    expect(mockPrisma.trainerProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'tp-1', applicationStatus: 'approved', isDiscoverable: true }) })
    );
  });

  test('detail returns displayName + certificationsV2', async () => {
    mockPrisma.trainerProfile.findFirst.mockResolvedValue({ ...TRAINER, certificationsV2: [{ name: 'NASM' }] });
    mockPrisma.trainerClient.count.mockResolvedValue(2);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'trainer-1', firstName: 'Terry', lastName: 'Ng' }]);
    const res = await request(app).get('/trainers/tp-1').set('x-user-id', 'u1');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Terry Ng');
    expect(res.body.certificationsV2).toHaveLength(1);
    expect(res.body.languages).toEqual(['en']);
    expect(res.body.coachingMode).toBe('both');
  });
});

// ---------------------------------------------------------------------------
// Applications + admin review
// ---------------------------------------------------------------------------
describe('applications + admin review', () => {
  test('save draft → submit → admin approve sets approved fields + audit', async () => {
    // Save draft (no existing profile)
    mockProfiles({ byUser: {} });
    mockPrisma.trainerProfile.create.mockResolvedValue({ id: 'tp-2', userId: 'applicant-1', applicationStatus: 'draft' });
    const draft = await request(app)
      .post('/trainers/applications')
      .set('x-user-id', 'applicant-1')
      .send({ bio: 'Coach for 10 years', specialties: ['Yoga'], yearsExperience: 10 });
    expect(draft.status).toBe(201);
    expect(mockPrisma.trainerProfile.create.mock.calls[0][0].data.applicationStatus).toBe('draft');
    // Legacy labels normalize to taxonomy ids.
    expect(mockPrisma.trainerProfile.create.mock.calls[0][0].data.specialties).toEqual(['yoga']);

    // Submit — draft complete
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'draft', bio: 'x', yearsExperience: 10, specialties: ['yoga'] } } });
    mockPrisma.trainerProfile.update.mockResolvedValue({ id: 'tp-2', applicationStatus: 'submitted' });
    const sub = await request(app).post('/trainers/applications/me/submit').set('x-user-id', 'applicant-1');
    expect(sub.status).toBe(200);
    expect(sub.body.applicationStatus).toBe('submitted');

    // Admin approve
    mockRoles('admin-1', ['ADMIN']);
    mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-2', userId: 'applicant-1', applicationStatus: 'submitted', verified: false, active: false });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'applicant-1', emailVerifiedAt: new Date() }]);
    mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-trainer', name: 'TRAINER' });
    mockPrisma.trainerProfile.update.mockResolvedValue({ id: 'tp-2', userId: 'applicant-1', applicationStatus: 'approved', verified: true, active: true });
    const res = await request(app)
      .patch('/admin/trainers/tp-2/review')
      .set('x-user-id', 'admin-1')
      .send({ decision: 'approve' });
    expect(res.status).toBe(200);
    const updateData = mockPrisma.trainerProfile.update.mock.calls.at(-1)[0].data;
    expect(updateData.applicationStatus).toBe('approved');
    expect(updateData.verified).toBe(true);
    expect(updateData.approvedBy).toBe('admin-1');
    expect(updateData.approvedAt).toBeInstanceOf(Date);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'trainer.review.approve' }) })
    );
  });

  test('reject + request_changes set status/note and un-verify', async () => {
    for (const [decision, status] of [['reject', 'rejected'], ['request_changes', 'changes_requested']]) {
      jest.clearAllMocks();
      mockPrisma.$transaction.mockImplementation(async (arg) => arg(mockPrisma));
      mockRoles('admin-1', ['ADMIN']);
      mockPrisma.trainerProfile.findUnique.mockResolvedValue({ id: 'tp-2', userId: 'applicant-1', applicationStatus: 'submitted', verified: false, active: false });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'applicant-1', emailVerifiedAt: new Date() }]);
      mockPrisma.role.findUnique.mockResolvedValue({ id: 'r-trainer', name: 'TRAINER' });
      mockPrisma.trainerProfile.update.mockResolvedValue({ id: 'tp-2', applicationStatus: status });
      mockPrisma.userRole.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.authSession.deleteMany.mockResolvedValue({ count: 0 });
      const res = await request(app)
        .patch('/admin/trainers/tp-2/review')
        .set('x-user-id', 'admin-1')
        .send({ decision, note: 'Needs work' });
      expect(res.status).toBe(200);
      const data = mockPrisma.trainerProfile.update.mock.calls[0][0].data;
      expect(data.applicationStatus).toBe(status);
      expect(data.applicationNote).toBe('Needs work');
      expect(data.verified).toBe(false);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: `trainer.review.${decision}` }) })
      );
    }
  });

  test('duplicate live application blocked; resubmit allowed from changes_requested', async () => {
    // submitted → POST /applications 409
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'submitted' } } });
    const dup = await request(app).post('/trainers/applications').set('x-user-id', 'applicant-1').send({ bio: 'x' });
    expect(dup.status).toBe(409);
    // under_review → blocked too
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'under_review' } } });
    expect((await request(app).post('/trainers/applications').set('x-user-id', 'applicant-1').send({})).status).toBe(409);
    // changes_requested → PATCH allowed
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'changes_requested' } } });
    mockPrisma.trainerProfile.update.mockResolvedValue({ id: 'tp-2', applicationStatus: 'changes_requested' });
    expect((await request(app).patch('/trainers/applications/me').set('x-user-id', 'applicant-1').send({ bio: 'updated' })).status).toBe(200);
    // submit from submitted → 409
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'submitted', bio: 'x', yearsExperience: 1, specialties: ['yoga'] } } });
    expect((await request(app).post('/trainers/applications/me/submit').set('x-user-id', 'applicant-1')).status).toBe(409);
  });

  test('submit validates required fields', async () => {
    mockProfiles({ byUser: { 'applicant-1': { id: 'tp-2', userId: 'applicant-1', applicationStatus: 'draft', bio: null, yearsExperience: 2, specialties: [] } } });
    const res = await request(app).post('/trainers/applications/me/submit').set('x-user-id', 'applicant-1');
    expect(res.status).toBe(400);
  });

  test('trainer cannot self-approve (MANAGE_TRAINERS required)', async () => {
    mockRoles('trainer-1', ['TRAINER']);
    const res = await request(app)
      .patch('/admin/trainers/tp-2/review')
      .set('x-user-id', 'trainer-1')
      .send({ decision: 'approve' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------
describe('certifications', () => {
  test('create forces verificationStatus unverified even when body says verified', async () => {
    mockProfiles({ byUser: { 'trainer-1': TRAINER } });
    mockPrisma.trainerCertification.create.mockImplementation(async ({ data }) => ({ id: 'cert-1', ...data }));
    const res = await request(app)
      .post('/trainers/me/certifications')
      .set('x-user-id', 'trainer-1')
      .send({ name: 'NASM CPT', issuingOrganization: 'NASM', verificationStatus: 'verified' });
    expect(res.status).toBe(201);
    expect(mockPrisma.trainerCertification.create.mock.calls[0][0].data.verificationStatus).toBe('unverified');
  });
});

// ---------------------------------------------------------------------------
// Granular feature flags
// ---------------------------------------------------------------------------
describe('granular trainer flags', () => {
  test('trainer_discovery off → GET / + /:id 403', async () => {
    setEnv('trainer_discovery', 'false');
    expect((await request(app).get('/trainers').set('x-user-id', 'u1')).status).toBe(403);
    expect((await request(app).get('/trainers/tp-1').set('x-user-id', 'u1')).status).toBe(403);
  });

  test('trainer_registration off → signup + applications 403', async () => {
    setEnv('trainer_registration', 'false');
    expect((await request(app).post('/trainers/signup').set('x-user-id', 'u1').send({})).status).toBe(403);
    expect((await request(app).post('/trainers/applications').set('x-user-id', 'u1').send({})).status).toBe(403);
    expect((await request(app).get('/trainers/applications/me').set('x-user-id', 'u1')).status).toBe(403);
  });

  test('trainer_coaching off → requests/relationships/subscribe 403', async () => {
    setEnv('trainer_coaching', 'false');
    expect((await request(app).get('/trainer-requests').set('x-user-id', 'u1')).status).toBe(403);
    expect((await request(app).post('/trainer-requests/r1/accept').set('x-user-id', 'u1')).status).toBe(403);
    expect((await request(app).put('/trainer-relationships/r1/consents').set('x-user-id', 'u1').send({})).status).toBe(403);
    expect((await request(app).post('/trainers/tp-1/subscribe').set('x-user-id', 'u1').send({})).status).toBe(403);
  });

  test('trainer_dashboard master off → everything 403 (dependsOn children too)', async () => {
    setEnv('trainer_dashboard', 'false');
    expect((await request(app).get('/trainers').set('x-user-id', 'u1')).status).toBe(403);
    expect((await request(app).get('/trainer-requests').set('x-user-id', 'u1')).status).toBe(403);
  });
});
