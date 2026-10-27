const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fitness_auth_readiness') throw new Error('Only disposable localhost fitness_auth_readiness is allowed.');
process.env.AUTH_TEST_BYPASS = 'false';
const prisma = new PrismaClient(); global.__fitnessPrisma = prisma;
const app = require('../../src/app');
const { hashPassword, createSession } = require('../../src/services/authService');
const password = 'History-recovery-123';
async function clear() { await prisma.$executeRawUnsafe(`TRUNCATE ${Prisma.dmmf.datamodel.models.map(m => `"${m.name}"`).join(',')} CASCADE`); }
async function account() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date(), passwordHash: await hashPassword(password) } });
  return createSession(user);
}
const auth = session => `Bearer ${session.token}`;
beforeEach(clear);
afterAll(async () => { await clear(); await prisma.$disconnect(); });
test('historical meals survive fresh login, recover on a second device and remain account-private', async () => {
  const owner = await account(), stranger = await account();
  const times = ['2025-01-01T00:00:00.000Z', '2025-01-01T23:59:59.999Z', '2025-01-02T00:00:00.000Z'];
  const ids = times.map(() => randomUUID());
  for (let i = 0; i < times.length; i++) {
    await request(app).post('/food-logs').set('Authorization', auth(owner)).send({ id: ids[i], foodName: 'Historical lunch', calories: 350, quantityG: 250, proteinG: 25, carbsG: 40, fatG: 10, loggedAt: times[i], fiberG: 5 }).expect(201);
  }
  // Reinstall/another device obtains a new session without any device cache or ID.
  const login = (await request(app).post('/auth/login').send({ email: owner.user.email, password }).expect(200)).body;
  const day = await request(app).get('/food-logs?date=2025-01-01').set('Authorization', auth(login)).expect(200);
  expect(day.body.logs.map(row => row.id).sort()).toEqual(ids.slice(0, 2).sort());
  expect(day.body.logs.reduce((sum, row) => sum + row.calories, 0)).toBe(700);
  expect(day.body.logs[0].fiberG).toBe(5);
  expect((await request(app).get('/food-logs?date=2025-01-02').set('Authorization', auth(login)).expect(200)).body.logs.map(row => row.id)).toEqual([ids[2]]);
  expect((await request(app).get('/food-logs?date=2025-01-01').set('Authorization', auth(stranger)).set('x-user-id', owner.user.id).expect(200)).body.logs).toEqual([]);
  await request(app).delete(`/food-logs/${ids[0]}`).set('Authorization', auth(stranger)).expect(200);
  expect(await prisma.foodLog.count()).toBe(3);
  await request(app).delete(`/food-logs/${ids[0]}`).set('Authorization', auth(owner)).expect(200);
  expect((await request(app).get('/food-logs?date=2025-01-01').set('Authorization', auth(login)).expect(200)).body.logs.map(row => row.id)).toEqual([ids[1]]);
  await request(app).get('/food-logs?date=2025-01-01').set('x-user-id', owner.user.id).expect(401);
});
test('rejects invalid calendar days and accepts an empty historical day', async () => {
  const owner = await account();
  for (const date of ['2025-02-30', '2025-13-01', 'invalid', '2025-01-01&date=2025-01-02']) {
    await request(app).get(`/food-logs?date=${date}`).set('Authorization', auth(owner)).expect(400);
  }
  expect((await request(app).get('/food-logs?date=2024-02-29').set('Authorization', auth(owner)).expect(200)).body.logs).toEqual([]);
});
