const request = require('supertest');

const PROFILE = {
  id: 'prof-1', ingredientId: 'ing-1', preparationType: 'OTHER', source: 'USDA',
  sourceFoodId: '2708958', sourceDataset: 'usda_fdc_usda-preview-1',
  sourceRecordKey: 'usda-preview-1|food:2708958', sourceCitation: 'USDA FDC SR Legacy fdcId 2708958',
  identityKey: 'ik-1', verifiedAt: null, createdAt: new Date(), updatedAt: new Date(),
  nutrients: [{ nutrientId: 'n1', amountPer100g: 25.5, nutrient: { code: 'PROTEIN', unit: 'g' } }],
  ingredient: { id: 'ing-1', name: 'Adobo, with rice', fdcId: 2708958 },
};

const mockPrisma = {
  userRole: { findMany: jest.fn() },
  ingredientNutritionProfile: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  auditLog: { findMany: jest.fn(), create: jest.fn() },
};
jest.mock('../src/lib/prisma', () => ({ getPrisma: () => mockPrisma }));
const app = require('../src/app');

const REVIEWER = 'reviewer-1', MEMBER = 'member-1';
const USER_PERMS = { [REVIEWER]: ['NUTRITION_DATA_REVIEW'], [MEMBER]: ['VIEW_OWN_PROFILE'] };
function mockRoles() {
  mockPrisma.userRole.findMany.mockImplementation(async ({ where }) =>
    (USER_PERMS[where.userId] || []).length === 0 ? [] : [{ userId: where.userId, active: true,
      role: { name: 'ADMIN', rolePermissions: USER_PERMS[where.userId].map((name) => ({ permission: { name } })) } }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.ingredientNutritionProfile.findUnique.mockResolvedValue({ ...PROFILE });
  mockPrisma.ingredientNutritionProfile.findMany.mockResolvedValue([PROFILE]);
  mockPrisma.ingredientNutritionProfile.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockRoles();
});

describe('GET /super-admin/nutrition-profiles', () => {
  it('lists pending profiles with nutrients + identity for reviewers', async () => {
    const res = await request(app).get('/super-admin/nutrition-profiles?status=pending&batch=usda_fdc_usda-preview-1').set('x-user-id', REVIEWER);
    if(res.status!==200) console.log('DIAG body:',JSON.stringify(res.body)); expect(res.status).toBe(200);
    expect(res.body.profiles[0].ingredient.fdcId).toBe(2708958);
    expect(mockPrisma.ingredientNutritionProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { verifiedAt: null, sourceDataset: 'usda_fdc_usda-preview-1' } }));
  });

  it('rejects non-reviewers (403) and missing auth (401)', async () => {
    expect((await request(app).get('/super-admin/nutrition-profiles').set('x-user-id', MEMBER)).status).toBe(403);
    expect((await request(app).get('/super-admin/nutrition-profiles')).status).toBe(401);
  });
});

describe('POST /:id/decision', () => {
  const ok = { decision: 'APPROVE', justification: 'Verified against USDA SR Legacy record 2708958' };

  it('APPROVE sets verifiedAt and audits the decision', async () => {
    const res = await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER).send(ok);
    if(res.status!==200) console.log('DIAG body:',JSON.stringify(res.body)); expect(res.status).toBe(200);
    expect(mockPrisma.ingredientNutritionProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'prof-1', verifiedAt: null }, data: { verifiedAt: expect.any(Date) } });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: REVIEWER, action: 'nutritionProfile.approve', entityId: 'prof-1' }) }));
  });

  it('REJECT/REQUEST_CHANGES never set verifiedAt', async () => {
    for (const decision of ['REJECT', 'REQUEST_CHANGES']) {
      jest.clearAllMocks(); mockPrisma.ingredientNutritionProfile.findUnique.mockResolvedValue({ ...PROFILE });
      const res = await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER)
        .send({ decision, justification: 'Needs prep-state clarification before approval' });
      if(res.status!==200) console.log('DIAG body:',JSON.stringify(res.body)); expect(res.status).toBe(200);
      expect(mockPrisma.ingredientNutritionProfile.updateMany).not.toHaveBeenCalled();
    }
  });

  it('requires justification ≥10 chars and a valid decision', async () => {
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER).send({ decision: 'APPROVE' })).status).toBe(400);
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER).send({ decision: 'YEET', justification: 'whatever justification' })).status).toBe(400);
  });

  it('blocks double-approval and concurrent-state conflicts (409)', async () => {
    mockPrisma.ingredientNutritionProfile.findUnique.mockResolvedValue({ ...PROFILE, verifiedAt: new Date() });
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER).send(ok)).status).toBe(409);
    mockPrisma.ingredientNutritionProfile.findUnique.mockResolvedValue({ ...PROFILE });
    mockPrisma.ingredientNutritionProfile.updateMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/decision').set('x-user-id', REVIEWER).send(ok)).status).toBe(409);
  });
});

describe('POST /:id/revoke', () => {
  it('clears verifiedAt only for verified profiles, audit-logged', async () => {
    mockPrisma.ingredientNutritionProfile.findUnique
      .mockResolvedValueOnce({ ...PROFILE, verifiedAt: new Date('2026-01-01') })
      .mockResolvedValueOnce({ ...PROFILE, verifiedAt: null });
    const res = await request(app).post('/super-admin/nutrition-profiles/prof-1/revoke').set('x-user-id', REVIEWER)
      .send({ justification: 'Superseded by updated FDC record' });
    if(res.status!==200) console.log('DIAG body:',JSON.stringify(res.body)); expect(res.status).toBe(200);
    expect(mockPrisma.ingredientNutritionProfile.updateMany).toHaveBeenCalledWith({
      where: { id: 'prof-1', verifiedAt: expect.any(Date) }, data: { verifiedAt: null } });
  });

  it('409s when profile is not verified; members cannot revoke', async () => {
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/revoke').set('x-user-id', REVIEWER).send({ justification: 'valid justification text' })).status).toBe(409);
    expect((await request(app).post('/super-admin/nutrition-profiles/prof-1/revoke').set('x-user-id', MEMBER).send({ justification: 'valid justification text' })).status).toBe(403);
  });
});
