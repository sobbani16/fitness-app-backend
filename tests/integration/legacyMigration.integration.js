const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/fitness_auth_readiness') throw new Error('Only disposable localhost fitness_auth_readiness is allowed.');
process.env.AUTH_TEST_BYPASS = 'false'; process.env.AUTH_LINK_SECRET = 'ab'.repeat(32);
const prisma = new PrismaClient(); global.__fitnessPrisma = prisma;
const app = require('../../src/app');
const { issueGrant } = require('../../src/services/legacyMigration');
const { hashPassword, createSession } = require('../../src/services/authService');
const password = 'Verified-account-123';
async function clear() { await prisma.$executeRawUnsafe(`TRUNCATE ${Prisma.dmmf.datamodel.models.map(m => `"${m.name}"`).join(',')} CASCADE`); }
async function fixture() {
  const source = await prisma.user.create({ data: { id: `dev-${Date.now().toString(36)}-${randomUUID().replaceAll('-','')}`, email: `temporary-${randomUUID()}@device.local` } });
  await prisma.user.update({ where: { id: source.id }, data: { email: `${source.id}@device.local` } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date(), passwordHash: await hashPassword(password) } });
  const target = await createSession(user);
  const role = await prisma.role.upsert({ where: { name: 'MEMBER' }, create: { name: 'MEMBER' }, update: {} });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  await prisma.foodLog.create({ data: { id: `meal-${randomUUID()}`, userId: source.id, foodName: 'Original meal', quantityG: 100, calories: 100, proteinG: 10, carbsG: 10, fatG: 2, mealType: 'lunch' } });
  return { source, target };
}
function grant(f) { return issueGrant({ legacyUserId: f.source.id, targetEmail: f.target.user.email, proofType: 'independent-support-review', evidenceReference: 'review-ticket-12345' }); }
function redeem(target, token, extra = {}) { return request(app).post('/me/legacy-migration/redeem').set('Authorization', `Bearer ${target.token}`).send({ token, password, ...extra }); }
beforeEach(clear);
afterAll(async () => { await clear(); await prisma.$disconnect(); });
test('device ID alone never authorizes access or migration', async () => {
  const f = await fixture();
  await request(app).get('/food-logs').set('x-user-id', f.source.id).expect(401);
  await request(app).post('/me/legacy-migration/redeem').set('x-user-id', f.source.id).send({ legacyUserId: f.source.id }).expect(401);
  await redeem(f.target, undefined, { legacyUserId: f.source.id }).expect(400);
  await expect(issueGrant({ legacyUserId: f.source.id, targetEmail: f.target.user.email, proofType: 'device-id', evidenceReference: f.source.id })).rejects.toThrow();
});
test('approved migration upgrades in place, preserves child IDs and revokes both old sessions', async () => {
  const f = await fixture(), before = await prisma.foodLog.findFirst({ where: { userId: f.source.id } });
  const token = await grant(f);
  expect(JSON.stringify(await prisma.legacyMigrationGrant.findMany())).not.toContain(token);
  const response = await redeem(f.target, token).expect(200);
  expect(response.body.user.id).toBe(f.source.id); expect(response.body.user.email).toBe(f.target.user.email);
  expect(await prisma.user.findUnique({ where: { id: f.target.user.id } })).toBeNull();
  expect((await prisma.foodLog.findUnique({ where: { id: before.id } })).userId).toBe(f.source.id);
  await request(app).get('/auth/me').set('Authorization', `Bearer ${f.target.token}`).expect(401);
  await request(app).get('/food-logs').set('Authorization', `Bearer ${response.body.token}`).expect(200);
  const login = await request(app).post('/auth/login').send({ email: f.target.user.email, password }).expect(200);
  expect(login.body.user.id).toBe(f.source.id);
  await redeem(response.body, token).expect(400);
  expect(await prisma.userRole.count({ where: { userId: f.source.id } })).toBe(1);
});
test('code is target-bound, requires current password, rejects expiration and concurrent replay', async () => {
  const f = await fixture(), other = await fixture(), token = await grant(f);
  await redeem(other.target, token).expect(400);
  await redeem(f.target, token, { password: 'wrong' }).expect(403);
  await prisma.legacyMigrationGrant.updateMany({ data: { expiresAt: new Date(0) } });
  await redeem(f.target, token).expect(400);
  const fresh = await grant(f);
  const responses = await Promise.all([redeem(f.target, fresh), redeem(f.target, fresh)]);
  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  expect(responses.filter(r => [400,401].includes(r.status))).toHaveLength(1);
});
test('destination data prevents migration without consuming the grant or losing either account', async () => {
  const f = await fixture(), token = await grant(f);
  await prisma.user.update({ where: { id: f.target.user.id }, data: { profileData: { name: 'Existing profile' } } });
  await redeem(f.target, token).expect(409);
  expect(await prisma.user.count()).toBe(2); expect(await prisma.foodLog.count()).toBe(1);
  expect((await prisma.legacyMigrationGrant.findFirst()).consumedAt).toBeNull();
});
test('unverified targets and privileged legacy profiles require separate review', async () => {
  const f = await fixture();
  await prisma.user.update({ where: { id: f.target.user.id }, data: { emailVerifiedAt: null } });
  await expect(grant(f)).rejects.toThrow();
  await prisma.user.update({ where: { id: f.target.user.id }, data: { emailVerifiedAt: new Date() } });
  const role = await prisma.role.create({ data: { name: 'ADMIN' } });
  await prisma.userRole.create({ data: { userId: f.source.id, roleId: role.id } });
  await expect(grant(f)).rejects.toThrow('specialist');
});
test('account deletion removes migration evidence and expired grants are pruned', async () => {
  const f = await fixture(); await grant(f);
  await request(app).post('/me/account/delete').set('Authorization', `Bearer ${f.target.token}`).send({ password, confirmation: 'DELETE' }).expect(200);
  expect(await prisma.legacyMigrationGrant.count()).toBe(0);
  const other = await fixture(); await grant(other);
  await prisma.legacyMigrationGrant.updateMany({ data: { expiresAt: new Date(0) } });
  await require('../../src/services/accountRetention').pruneRetainedRecords();
  expect(await prisma.legacyMigrationGrant.count()).toBe(0);
});
