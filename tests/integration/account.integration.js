const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/fitness_auth_readiness') throw new Error('Use only disposable localhost fitness_auth_readiness.');
process.env.AUTH_TEST_BYPASS = 'false';
process.env.AUTH_LINK_SECRET = 'ab'.repeat(32);
const prisma = new PrismaClient(); global.__fitnessPrisma = prisma;
const app = require('../../src/app');
const { OWNED } = require('../../src/services/accountData');
const { hashPassword, createSession } = require('../../src/services/authService');
const password = 'Account-password-123';
const modelName = name => name[0].toLowerCase() + name.slice(1);
const models = Prisma.dmmf.datamodel.models;
async function clear() {
  // Exact database guard above; this database is dedicated to destructive fixture tests.
  await prisma.$executeRawUnsafe(`TRUNCATE ${models.map(m => `"${m.name}"`).join(',')} CASCADE`);
}
async function account() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: await hashPassword(password) } });
  return createSession(user);
}
const call = (who, path, body = { password }) => request(app).post(`/me/account/${path}`).set('Authorization', `Bearer ${who.token}`).send(body);
// Fill required scalar fields so every owned table is represented, rather than testing just the user row.
async function seed(name, overrides = {}) {
  const model = models.find(m => modelName(m.name) === name), data = {};
  for (const f of model.fields) {
    if (f.kind === 'object' || !f.isRequired || f.hasDefaultValue || f.isUpdatedAt) continue;
    data[f.name] = f.isList ? [] : f.type === 'String' ? randomUUID() : f.type === 'DateTime' ? new Date() : f.type === 'Boolean' ? false : f.type === 'Json' ? {} : 1;
  }
  return prisma[name].create({ data: { ...data, ...overrides } });
}
async function fixture(who) {
  const userId = who.user.id;
  const condition = await seed('healthCondition'), allergy = await seed('allergy'), supplement = await seed('supplement'), ingredient = await seed('ingredient'), role = await seed('role');
  const selection = await seed('userSupplement', { userId, supplementId: supplement.id });
  const plan = await seed('weeklyNutritionPlan', { userId });
  const trainer = await seed('trainerProfile', { userId });
  for (const name of OWNED) {
    if (['userSupplement', 'weeklyNutritionPlan'].includes(name)) continue;
    const overrides = { userId };
    const m = models.find(m => modelName(m.name) === name);
    const fields = m.fields.map(f => f.name);
    if (fields.includes('trainerId')) overrides.trainerId = trainer.id;
    if (fields.includes('conditionId')) overrides.conditionId = condition.id;
    if (fields.includes('allergyId')) overrides.allergyId = allergy.id;
    if (fields.includes('supplementId')) overrides.supplementId = supplement.id;
    if (fields.includes('ingredientId')) overrides.ingredientId = ingredient.id;
    if (fields.includes('roleId')) overrides.roleId = role.id;
    if (fields.includes('userSupplementId')) overrides.userSupplementId = selection.id;
    if (fields.includes('planId')) overrides.planId = plan.id;
    await seed(name, overrides);
  }
  const workout = await prisma.workoutSession.findFirst({ where: { userId } });
  await seed('exerciseSet', { workoutSessionId: workout.id });
  const score = await prisma.healthScore.findFirst({ where: { userId } });
  await seed('scoreContributor', { healthScoreId: score.id }); await seed('healthScoreInsight', { healthScoreId: score.id });
  await seed('weeklyMeal', { planId: plan.id });
  const shopping = await seed('weeklyShoppingList', { planId: plan.id }); await seed('weeklyShoppingItem', { shoppingListId: shopping.id });
  const review = await prisma.weeklyReview.findFirst({ where: { userId } }); await seed('weeklyRecommendation', { reviewId: review.id });
  return { supplement, workout, plan };
}
beforeEach(clear);
afterAll(async () => { await clear(); await prisma.$disconnect(); });

test('all schema models are explicitly classified for deletion/export review', () => {
  const special = ['legacyMigrationGrant', 'user', 'authSession', 'authAction', 'authRateBucket', 'accountDeletionReceipt', 'trainerProfile', 'nutritionistProfile', 'creatorProfile', 'recipe', 'auditLog', 'trainerClient', 'nutritionistClient', 'trainerDropForm', 'coachNote', 'workoutPlan', 'mealPlan'];
  const children = ['exerciseSet','recipeIngredient','creatorAnalytics','workoutPlanExercise','mealPlanItem','scoreContributor','healthScoreInsight','weeklyMeal','weeklyShoppingList','weeklyShoppingItem','weeklyRecommendation'];
  const shared = ['ruleEvidence','healthConditionNutrientRule','nutrient','ingredientNutritionProfile','ingredientNutrient','ingredientImport','ingredientServing','ingredientCatalog','healthCondition','allergy','supplement','ingredient','ingredientAttribute','supplementAttribute','conditionRule','supplementRule','role','permission','rolePermission'];
  expect(models.map(m => modelName(m.name)).filter(m => ![...OWNED,...special,...children,...shared].includes(m))).toEqual([]);
});
test('requires session, current password, explicit deletion confirmation; unverified users retain privacy access', async () => {
  const who = await account();
  await request(app).post('/me/account/export').send({ password }).expect(401);
  await call(who, 'export', { password: 'incorrect-password' }).expect(403);
  await call(who, 'delete', { password }).expect(400);
  await call(who, 'delete', { password: 'wrong', confirmation: 'DELETE' }).expect(403);
  await call(who, 'export').expect(200);
  expect(await prisma.user.count()).toBe(1);
});
test('full export includes nested personal data and excludes credentials, private notes and other accounts', async () => {
  const who = await account(), other = await account(); await fixture(who); await fixture(other);
  await seed('coachNote', { coachId: other.user.id, clientId: who.user.id, visibility: 'private', note: 'PRIVATE-SECRET' });
  await seed('coachNote', { coachId: other.user.id, clientId: who.user.id, visibility: 'client_visible', note: 'Visible guidance' });
  const res = await call(who, 'export', { password, userId: other.user.id }).expect(200);
  expect(res.headers['cache-control']).toBe('no-store'); expect(res.headers['content-disposition']).toContain('attachment');
  expect(res.body.data.profile.id).toBe(who.user.id);
  expect(res.body.data.workoutSession[0].exerciseSets).toHaveLength(1);
  expect(res.body.data.weeklyNutritionPlan[0].shoppingList.items).toHaveLength(1);
  expect(res.text).not.toContain('passwordHash'); expect(res.text).not.toContain('tokenHash'); expect(res.text).not.toContain(who.token);
  expect(res.text).not.toContain(other.user.email); expect(res.text).not.toContain('PRIVATE-SECRET'); expect(res.text).toContain('Visible guidance');
  for (const model of OWNED) expect(res.body.data[model].every(row => row.userId === who.user.id)).toBe(true);
});
test('deletion cleans every owned table, restrictive children, auth links and subject audit snapshots; preserves another account', async () => {
  const who = await account(), other = await account(); const f = await fixture(who); await fixture(other);
  await seed('authAction', { userId: who.user.id, email: who.user.email, purpose: 'reset-password' });
  await seed('auditLog', { actorId: other.user.id, afterData: { userId: who.user.id }, action: 'role.assign' });
  await seed('auditLog', { actorId: other.user.id, action: 'unrelated' });
  await call(who, 'delete', { password, confirmation: 'DELETE', userId: other.user.id }).expect(200);
  for (const model of OWNED) {
    expect(await prisma[model].count({ where: { userId: who.user.id } })).toBe(0);
    expect(await prisma[model].count({ where: { userId: other.user.id } })).toBeGreaterThan(0);
  }
  expect(await prisma.exerciseSet.count({ where: { workoutSessionId: f.workout.id } })).toBe(0);
  expect(await prisma.authAction.count({ where: { userId: who.user.id } })).toBe(0);
  expect(await prisma.authSession.count({ where: { userId: who.user.id } })).toBe(0);
  expect(await prisma.auditLog.count()).toBe(1);
  expect(await prisma.supplement.findUnique({ where: { id: f.supplement.id } })).not.toBeNull();
  const receipt = await prisma.accountDeletionReceipt.findUnique({ where: { userId: who.user.id } });
  expect(Object.keys(receipt).sort()).toEqual(['deletedAt','expiresAt','userId']);
  await call(who, 'export').expect(401); await call(who, 'delete', { password, confirmation: 'DELETE' }).expect(401);
});
test('coach/creator deletion cleans assignments, notes, waitlists and plans without deleting clients or their meal snapshots', async () => {
  const coach = await account(), client = await account();
  const trainer = await seed('trainerProfile', { userId: coach.user.id }), nutritionist = await seed('nutritionistProfile', { userId: coach.user.id }), creator = await seed('creatorProfile', { userId: coach.user.id });
  await seed('creatorAnalytics', { creatorId: creator.id });
  const relation = await seed('trainerClient', { trainerId: trainer.id, clientId: client.user.id });
  await seed('trainerDropForm', { trainerId: trainer.id, clientId: client.user.id, relationId: relation.id });
  await seed('trainerWaitlist', { userId: client.user.id, trainerId: trainer.id });
  await seed('nutritionistClient', { nutritionistId: nutritionist.id, clientId: client.user.id });
  await seed('coachNote', { coachId: coach.user.id, clientId: client.user.id, trainerId: trainer.id });
  const wp = await seed('workoutPlan', { trainerId: trainer.id, clientId: client.user.id }); await seed('workoutPlanExercise', { workoutPlanId: wp.id });
  const mp = await seed('mealPlan', { nutritionistId: nutritionist.id, clientId: client.user.id }); await seed('mealPlanItem', { mealPlanId: mp.id });
  const recipe = await seed('recipe', { creatorId: creator.id }); await seed('recipeIngredient', { recipeId: recipe.id });
  const plan = await seed('weeklyNutritionPlan', { userId: client.user.id });
  const meal = await seed('weeklyMeal', { planId: plan.id, recipeId: recipe.id, foodName: 'Preserved meal snapshot' });
  await call(coach, 'delete', { password, confirmation: 'DELETE' }).expect(200);
  for (const model of ['trainerProfile','nutritionistProfile','creatorProfile','creatorAnalytics','trainerClient','trainerDropForm','trainerWaitlist','nutritionistClient','coachNote','workoutPlan','workoutPlanExercise','mealPlan','mealPlanItem','recipe','recipeIngredient']) expect(await prisma[model].count()).toBe(0);
  expect((await prisma.weeklyMeal.findUnique({ where: { id: meal.id } })).recipeId).toBeNull();
  expect(await prisma.user.findUnique({ where: { id: client.user.id } })).not.toBeNull();
});
test('failed deletion rolls back data removal and leaves sessions valid', async () => {
  const who = await account(); await fixture(who);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_delete_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_delete_fixture BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION fail_delete_fixture()`);
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await call(who, 'delete', { password, confirmation: 'DELETE' }).expect(500);
    expect(await prisma.foodLog.count({ where: { userId: who.user.id } })).toBe(1);
    expect(await prisma.accountDeletionReceipt.count()).toBe(0);
    await call(who, 'export').expect(200);
  } finally { log.mockRestore(); await prisma.$executeRawUnsafe('DROP TRIGGER fail_delete_fixture ON "User"'); await prisma.$executeRawUnsafe('DROP FUNCTION fail_delete_fixture()'); }
});
test('deleted accounts cannot be resurrected by late owned writes and audit logging', async () => {
  const who = await account(), other = await account();
  await call(who, 'delete', { password, confirmation: 'DELETE' }).expect(200);
  await expect(seed('notification', { userId: who.user.id })).rejects.toThrow();
  await expect(seed('auditLog', { actorId: other.user.id, afterData: { userId: who.user.id } })).rejects.toThrow();
});
test('account operations are persistently rate limited', async () => {
  const who = await account();
  for (let i = 0; i < 5; i++) await call(who, 'export', { password: 'wrong' }).expect(403);
  await call(who, 'export').expect(429);
});

test('in-flight user-owned writes finish before deletion and are removed', async () => {
  const who = await account();
  let release, locked;
  const ready = new Promise(resolve => { locked = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const writer = prisma.$transaction(async tx => {
    await tx.notification.create({ data: { userId: who.user.id, type: 'test', title: 'test', body: 'test' } });
    locked(); await wait;
  });
  await ready;
  const deletion = call(who, 'delete', { password, confirmation: 'DELETE' }).then(response => response);
  release(); await writer; expect((await deletion).status).toBe(200);
  expect(await prisma.notification.count({ where: { userId: who.user.id } })).toBe(0);
});
test('deletion receipts prevent same-ID restoration and late creator/waitlist writes', async () => {
  const who = await account(), other = await account();
  const trainer = await seed('trainerProfile', { userId: who.user.id });
  await call(who, 'delete', { password, confirmation: 'DELETE' }).expect(200);
  await expect(prisma.user.create({ data: { id: who.user.id, email: who.user.email } })).rejects.toThrow();
  await expect(seed('trainerWaitlist', { userId: other.user.id, trainerId: trainer.id })).rejects.toThrow();
  await expect(seed('recipe', { creatorId: who.user.id })).rejects.toThrow();
});

test('retention maintenance expires receipts, sessions, email actions and rate buckets without removing live records', async () => {
  const who = await account();
  await prisma.accountDeletionReceipt.create({ data: { userId: 'expired-receipt', expiresAt: new Date(0) } });
  await prisma.accountDeletionReceipt.create({ data: { userId: 'current-receipt', expiresAt: new Date(Date.now() + 86400000) } });
  await prisma.authSession.create({ data: { userId: who.user.id, tokenHash: 'expired', expiresAt: new Date(0) } });
  await seed('authAction', { userId: who.user.id, email: who.user.email, purpose: 'verify-email', expiresAt: new Date(0) });
  await seed('authAction', { userId: who.user.id, email: who.user.email, purpose: 'verify-email', expiresAt: new Date(Date.now() + 86400000) });
  await prisma.authRateBucket.create({ data: { key: 'old', count: 1, expiresAt: new Date(0) } });
  await prisma.authRateBucket.create({ data: { key: 'current', count: 1, expiresAt: new Date(Date.now() + 86400000) } });
  const { pruneRetainedRecords } = require('../../src/services/accountRetention');
  expect(await pruneRetainedRecords()).toEqual({ receipts: 1, sessions: 1, actions: 1, buckets: 1 });
  expect(await prisma.accountDeletionReceipt.count()).toBe(1);
  expect(await prisma.authSession.count()).toBe(1);
  expect(await prisma.authAction.count()).toBe(1);
  expect(await prisma.authRateBucket.count()).toBe(1);
  expect(await prisma.user.count()).toBe(1);
});
