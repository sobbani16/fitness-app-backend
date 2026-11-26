// Clinical rule approval workflow: permission gate, attestation requirement,
// gap blocking, and audit trail.
jest.mock('../src/lib/prisma', () => { const db = {
  userRole: { findMany: jest.fn(async () => []) },
  conditionRule: { findMany: jest.fn(async () => []), findUnique: jest.fn(), update: jest.fn() },
  healthConditionNutrientRule: { findMany: jest.fn(async () => []), findUnique: jest.fn(), update: jest.fn() },
  safetyAuditLog: { create: jest.fn(async () => ({})) },
  clinicalRuleEvent: { create: jest.fn(async ({ data }) => ({ id: 'ev1', ...data })) },
  $transaction: jest.fn(async (fn) => (Array.isArray(fn) ? Promise.all(fn) : fn(db))),
}; return { getPrisma: () => db }; });

const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/lib/prisma').getPrisma();

const reviewerRole = (perm) => [{ role: { name: 'CLINICAL_REVIEWER', rolePermissions: [{ permission: { name: perm } }] } }];
const ATTEST = 'Reviewed against NIH/NIDDK celiac guideline and ACG 2023 update.';

const legacyRule = { id: 'r1', reviewStatus: 'DRAFT', evidenceSourceId: null, evidence: null, action: 'block' };
const evidenceRule = { id: 'r2', reviewStatus: 'REVIEWED', evidenceSourceId: 'ev1', evidence: { organization: 'NIH' }, action: 'block' };
const nutrientNoThreshold = { id: 'r3', reviewStatus: 'DRAFT', evidenceSourceId: 'ev1', evidence: { organization: 'AHA' }, action: 'LIMIT', thresholdValue: null };

describe('clinical rule approval workflow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('list endpoint requires VIEW_PLATFORM_ANALYTICS', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);
    const res = await request(app).get('/admin/clinical-rules').set('x-user-id', 'plain-user');
    expect(res.status).toBe(403);
  });

  test('list returns rules with computed gaps', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('VIEW_PLATFORM_ANALYTICS'));
    prisma.conditionRule.findMany.mockResolvedValue([legacyRule]);
    prisma.healthConditionNutrientRule.findMany.mockResolvedValue([nutrientNoThreshold]);
    const res = await request(app).get('/admin/clinical-rules').set('x-user-id', 'rev');
    expect(res.status).toBe(200);
    expect(res.body.conditionRules[0].gaps).toContain('no_evidence_source');
    expect(res.body.nutrientRules[0].gaps).toContain('limit_without_threshold');
  });

  test('transition blocked without ACADEMY_CLINICAL_REVIEW', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'u')
      .send({ type: 'condition', id: 'r2', to: 'APPROVED', attestation: ATTEST });
    expect(res.status).toBe(403);
    expect(prisma.conditionRule.update).not.toHaveBeenCalled();
  });

  test('APPROVED blocked by no_evidence_source gap', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.conditionRule.findUnique.mockResolvedValue(legacyRule);
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'condition', id: 'r1', to: 'APPROVED', attestation: ATTEST });
    expect(res.status).toBe(422);
    expect(res.body.gaps).toContain('no_evidence_source');
    expect(prisma.conditionRule.update).not.toHaveBeenCalled();
  });

  test('APPROVED blocked by limit_without_threshold on nutrient rules', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.healthConditionNutrientRule.findUnique.mockResolvedValue(nutrientNoThreshold);
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'nutrient', id: 'r3', to: 'APPROVED', attestation: ATTEST });
    expect(res.status).toBe(422);
    expect(res.body.gaps).toContain('limit_without_threshold');
  });

  test('APPROVED requires >=20-char attestation', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.conditionRule.findUnique.mockResolvedValue(evidenceRule);
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'condition', id: 'r2', to: 'APPROVED', attestation: 'ok' });
    expect(res.status).toBe(422);
  });

  test('valid approval writes reviewer + audit', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.conditionRule.findUnique.mockResolvedValue(evidenceRule);
    prisma.conditionRule.update.mockResolvedValue({ ...evidenceRule, reviewStatus: 'APPROVED', reviewedBy: 'rev', reviewedAt: new Date(), version: 2 });
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'condition', id: 'r2', to: 'APPROVED', attestation: ATTEST });
    expect(res.status).toBe(200);
    expect(res.body.reviewStatus).toBe('APPROVED');
    expect(res.body.reviewedBy).toBe('rev');
    expect(prisma.safetyAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ checkType: 'clinical_rule_review' }),
    }));
  });

  test('from-state guard: REJECTED/DRAFT rules cannot jump straight to APPROVED', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    for (const from of ['REJECTED', 'DRAFT', 'APPROVED', 'RETIRED']) {
      prisma.conditionRule.findUnique.mockResolvedValue({ ...evidenceRule, reviewStatus: from });
      const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
        .send({ type: 'condition', id: 'r2', to: 'APPROVED', attestation: ATTEST });
      if (from === 'DRAFT') {
        // complete rules in DRAFT are blocked by state; incomplete ones by gaps
        expect([409, 422]).toContain(res.status);
      } else {
        expect(res.status).toBe(409);
      }
    }
    expect(prisma.conditionRule.update).not.toHaveBeenCalled();
  });

  test('every transition writes an immutable ClinicalRuleEvent with the verified role', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.conditionRule.findUnique.mockResolvedValue(evidenceRule);
    prisma.conditionRule.update.mockResolvedValue({ ...evidenceRule, reviewStatus: 'APPROVED', version: 2 });
    await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'condition', id: 'r2', to: 'APPROVED', attestation: ATTEST });
    expect(prisma.clinicalRuleEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ruleTable: 'conditionRule', ruleId: 'r2', fromStatus: 'REVIEWED', toStatus: 'APPROVED', action: 'approve', actorId: 'rev', actorRole: expect.stringContaining('CLINICAL_REVIEWER') }),
    }));
  });

  test('DRAFT demotion needs no attestation', async () => {
    prisma.userRole.findMany.mockResolvedValue(reviewerRole('ACADEMY_CLINICAL_REVIEW'));
    prisma.conditionRule.findUnique.mockResolvedValue({ ...evidenceRule, reviewStatus: 'APPROVED' });
    prisma.conditionRule.update.mockResolvedValue({ ...evidenceRule, reviewStatus: 'DRAFT', version: 3 });
    const res = await request(app).post('/admin/clinical-rules/transition').set('x-user-id', 'rev')
      .send({ type: 'condition', id: 'r2', to: 'DRAFT' });
    expect(res.status).toBe(200);
  });
});
