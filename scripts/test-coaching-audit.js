const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !/^\/fitness_c10_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Dedicated localhost fitness_c10_* database required');
Object.assign(process.env, { AUTH_TEST_BYPASS: 'false', NODE_ENV: 'test', AUTH_LINK_SECRET: 'ab'.repeat(32), AUTH_PUBLIC_URL: 'http://localhost:4000', AUTH_EMAIL_FROM: 'Fixture <accounts@example.test>', RESEND_API_KEY: 'test-only-no-network' });
const { getPrisma } = require('../src/lib/prisma');
const { createSession } = require('../src/services/authService');
const audit = require('../src/services/auditService');
const db = getPrisma(), app = require('../src/app');
const models = ['trainerProfile', 'trainerClient', 'trainerDropForm', 'nutritionistProfile', 'nutritionistClient', 'workoutPlan', 'workoutPlanExercise', 'mealPlan', 'mealPlanItem', 'coachNote', 'auditLog'];
async function snapshot() {
  const output = {};
  for (const model of models) output[model] = await db[model].findMany({ orderBy: { id: 'asc' } });
  return JSON.stringify(output);
}
async function account(roleName) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, emailVerifiedAt: new Date() } });
  const role = await db.role.findUnique({ where: { name: roleName } });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  return { id: user.id, token: (await createSession(user)).token };
}
const call = (who, method, path, body) => request(app)[method](path).set('Authorization', `Bearer ${who.token}`).send(body);
async function check(who, method, path, body, action, entityType, successStatus = 200) {
  const before = await snapshot(), original = audit.log;
  audit.log = async () => { throw Error('Injected audit failure'); };
  try { const failed = await call(who, method, path, body); assert(failed.status >= 400, path); }
  finally { audit.log = original; }
  assert.equal(await snapshot(), before, `Audit failure must roll back all changes: ${path}`);
  const count = await db.auditLog.count();
  const response = await call(who, method, path, body);
  assert.equal(response.status, successStatus, `${path}: ${JSON.stringify(response.body)}`);
  assert.equal(await db.auditLog.count(), count + 1, path);
  const event = await db.auditLog.findFirst({ orderBy: { createdAt: 'desc' } });
  assert.equal(event.actorId, who.id); assert.equal(event.action, action); assert.equal(event.entityType, entityType);
  assert(!JSON.stringify(event).includes('PRIVATE'), path);
  console.log(`PASS rollback + audit: ${method.toUpperCase()} ${path}`);
  return response.body;
}
(async () => {
  assert.equal(await db.user.count(), 0); assert.equal(await db.auditLog.count(), 0);
  try {
    const admin = await account('SUPER_ADMIN'), coach = await account('TRAINER'), nutritionist = await account('NUTRITIONIST');
    const client = await account('MEMBER'), applicant = await account('MEMBER');
    const trainer = await db.trainerProfile.create({ data: { userId: coach.id, certifications: [], specialties: [], active: true, verified: true } });
    const np = await db.nutritionistProfile.create({ data: { userId: nutritionist.id, certifications: [], specialties: [], active: true, verified: true } });
    await check(applicant, 'post', '/trainers/signup', { bio: 'PRIVATE biography' }, 'trainer.signup', 'TrainerProfile', 201);
    await check(coach, 'patch', '/trainers/me/profile', { bio: 'PRIVATE update' }, 'trainer.profile_updated', 'TrainerProfile');
    await check(admin, 'post', '/trainers/clients/assign', { trainerId: trainer.id, clientId: client.id }, 'client.assign', 'TrainerClient', 201);
    await check(coach, 'patch', `/trainers/clients/${client.id}/status`, { status: 'paused' }, 'client.status_update', 'TrainerClient');
    await db.trainerClient.updateMany({ data: { status: 'active', lockedUntil: new Date(0) } });
    await check(coach, 'post', '/workout-plans', { clientId: client.id, title: 'PRIVATE plan', exercises: [{ exerciseName: 'Squat', sets: 3, reps: 5 }] }, 'plan.create', 'WorkoutPlan', 201);
    await check(admin, 'post', '/nutritionists/clients/assign', { nutritionistId: np.id, clientId: client.id }, 'client.assign', 'NutritionistClient', 201);
    await db.nutritionistClient.updateMany({ data: { status: 'active' } });
    await check(nutritionist, 'post', '/meal-plans', { clientId: client.id, title: 'PRIVATE diet', caloriesTarget: 2000, proteinTarget: 120, items: [{ foodName: 'PRIVATE food', mealType: 'lunch' }] }, 'plan.create', 'MealPlan', 201);
    await check(coach, 'post', '/coach-notes', { clientId: client.id, note: 'PRIVATE diagnosis', visibility: 'private' }, 'coach_note.create', 'CoachNote', 201);
    await check(nutritionist, 'post', '/coach-notes', { clientId: client.id, note: 'PRIVATE nutrition', visibility: 'client_visible' }, 'coach_note.create', 'CoachNote', 201);
    const stranger = await account('MEMBER');
    const count = await db.auditLog.count();
    await call(stranger, 'post', '/workout-plans', { clientId: client.id, title: 'forbidden' }).expect(403);
    await call(coach, 'post', '/coach-notes', { clientId: stranger.id, note: 'forbidden' }).expect(403);
    assert.equal(await db.auditLog.count(), count);
    await check(coach, 'post', `/trainers/clients/${client.id}/drop`, { reasons: ['personal_reasons'], notes: 'PRIVATE survey' }, 'client.dropped_by_trainer', 'TrainerClient');
    await db.trainerClient.updateMany({ data: { status: 'active', lockedUntil: new Date(0) } });
    await check(client, 'post', '/trainers/me/drop', { reasons: ['personal_reasons'], notes: 'PRIVATE response', trainerRating: 5 }, 'trainer.dropped_by_client', 'TrainerClient');
    await db.trainerClient.updateMany({ data: { status: 'active', lockedUntil: new Date(0) } });
    const secondCoach = await account('TRAINER');
    const second = await db.trainerProfile.create({ data: { userId: secondCoach.id, certifications: [], specialties: [], active: true, verified: true, maxClients: 1 } });
    await check(client, 'post', `/trainers/${second.id}/subscribe`, {}, 'trainer.subscribed', 'TrainerClient', 201);
    // Audit failure above must also restore the previous trainer when switching.
    assert.equal(await db.trainerClient.count({ where: { clientId: client.id, status: 'active' } }), 1);
    const thirdCoach = await account('TRAINER');
    const third = await db.trainerProfile.create({ data: { userId: thirdCoach.id, certifications: [], specialties: [], active: true, verified: true, maxClients: 1 } });
    const challenger = await account('MEMBER');
    const responses = await Promise.all([stranger, challenger].map(who => call(who, 'post', `/trainers/${third.id}/subscribe`, {})));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(await db.trainerClient.count({ where: { trainerId: third.id, status: 'active' } }), 1);
    console.log('PASS unauthorized writes leave no audit; concurrent subscriptions respect capacity');
  } finally {
    for (const model of ['auditLog', 'coachNote', 'trainerDropForm', 'workoutPlan', 'mealPlan', 'trainerClient', 'nutritionistClient', 'trainerProfile', 'nutritionistProfile', 'userRole', 'user', 'authRateBucket']) await db[model].deleteMany();
    await db.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
