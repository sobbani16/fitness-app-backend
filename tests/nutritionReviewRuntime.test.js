// pc-HUM-36 — runtime verification of the reviewer workflow API.
// The static contract test pins source shape; this proves runtime behavior:
// justification enforcement, APPROVE-only verifiedAt, optimistic-concurrency
// 409, revoke flow, immutable audit, RBAC denial.
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/super-admin/nutrition-profiles', require('../src/routes/nutritionReview'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const ADMIN = 'nr-admin-u';
const OUTSIDER = 'nr-outsider-u';
const ING = 'nr-test-ingredient';
let profileId;

beforeAll(async () => {
  process.env.AUTH_TEST_BYPASS = 'true';
  for (const id of [ADMIN, OUTSIDER]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@device.local` } });
  }
  // Grant ADMIN the reviewer permission via the SUPER_ADMIN role chain if the
  // RBAC tables are present; fall back gracefully when seeded differently.
  try {
    const role = await prisma.role.upsert({ where: { name: 'SUPER_ADMIN' }, update: {}, create: { name: 'SUPER_ADMIN', description: 'test' } });
    await prisma.userRole.deleteMany({ where: { userId: ADMIN } });
    await prisma.userRole.create({ data: { userId: ADMIN, roleId: role.id } });
  } catch (e) { /* role model variance — permission tests will show it */ }
  await prisma.ingredient.upsert({
    where: { id: ING }, update: {},
    create: { id: ING, normalizedName: 'nr test ingredient', name: 'NR Test Ingredient', caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 10, fatPer100g: 2, source: 'test' },
  });
  await prisma.ingredientNutritionProfile.deleteMany({ where: { ingredientId: ING } }).catch(() => {});
  const p = await prisma.ingredientNutritionProfile.create({ data: {
    ingredientId: ING, preparationType: 'RAW', source: 'USDA', sourceFoodId: '2515374',
    sourceDataset: 'nr-test-batch', sourceRecordKey: 'nr-1', sourceCitation: 'USDA FDC test fixture',
    identityKey: `nr-test-${Date.now()}`,
  } });
  profileId = p.id;
});

afterAll(async () => {
  await prisma.ingredientNutritionProfile.deleteMany({ where: { ingredientId: ING } }).catch(() => {});
  await prisma.ingredient.deleteMany({ where: { id: ING } }).catch(() => {});
  await prisma.userRole.deleteMany({ where: { userId: { in: [ADMIN, OUTSIDER] } } }).catch(() => {});
  await prisma.$disconnect();
});

const decide = (user, id, body) => request(app).post(`/super-admin/nutrition-profiles/${id}/decision`).set({ 'x-user-id': user }).send(body);

describe('reviewer workflow runtime', () => {
  it('rejects decision without justification (min 10 chars)', async () => {
    const res = await decide(ADMIN, profileId, { decision: 'APPROVE', justification: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/justification required/);
  });

  it('rejects invalid decision verbs', async () => {
    const res = await decide(ADMIN, profileId, { decision: 'YOLO', justification: 'long enough justification' });
    expect(res.status).toBe(400);
  });

  it('denies users without NUTRITION_DATA_REVIEW permission', async () => {
    const res = await decide(OUTSIDER, profileId, { decision: 'APPROVE', justification: 'outsider attempt logged' });
    expect([401, 403]).toContain(res.status);
  });

  it('APPROVE sets verifiedAt exactly once; second approve conflicts 409', async () => {
    const first = await decide(ADMIN, profileId, { decision: 'APPROVE', justification: 'source verified against citation' });
    if (first.status !== 200) { console.log('approve status', first.status, first.body); }
    expect(first.status).toBe(200);
    const p = await prisma.ingredientNutritionProfile.findUnique({ where: { id: profileId } });
    expect(p.verifiedAt).toBeTruthy();
    const second = await decide(ADMIN, profileId, { decision: 'APPROVE', justification: 'duplicate approve attempt' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already verified/);
  });

  it('immutable audit trail records the decision with justification', async () => {
    const hist = await request(app).get(`/super-admin/nutrition-profiles/${profileId}/history`).set({ 'x-user-id': ADMIN });
    expect(hist.status).toBe(200);
    const approveEntry = (hist.body.history || []).find((h) => h.action === 'nutritionProfile.approve');
    expect(approveEntry).toBeTruthy();
    expect(approveEntry.afterData.justification).toBe('source verified against citation');
    expect(approveEntry.actorId).toBe(ADMIN);
  });

  it('revoke requires justification and clears verifiedAt — re-approval possible after', async () => {
    const noJust = await request(app).post(`/super-admin/nutrition-profiles/${profileId}/revoke`).set({ 'x-user-id': ADMIN }).send({ justification: 'x' });
    expect(noJust.status).toBe(400);
    const ok = await request(app).post(`/super-admin/nutrition-profiles/${profileId}/revoke`).set({ 'x-user-id': ADMIN }).send({ justification: 'source citation mismatch discovered' });
    expect(ok.status).toBe(200);
    const p = await prisma.ingredientNutritionProfile.findUnique({ where: { id: profileId } });
    expect(p.verifiedAt).toBeNull();
    const reApprove = await decide(ADMIN, profileId, { decision: 'APPROVE', justification: 're-verified after correction' });
    expect(reApprove.status).toBe(200);
  });
});
