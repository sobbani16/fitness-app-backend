// Trainer nutrition guidance — lifecycle, allergy warnings, consent gating,
// flag enforcement, and FoodLog safety. Uses the real prisma client against
// the dev database (same pattern as exerciseLibrary.test.js).
process.env.FF_TRAINER_NUTRITION_GUIDANCE_ENABLED = 'true';
process.env.FF_TRAINER_ADVANCED_FEATURES_ENABLED = 'true';

const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const flags = require('../src/services/featureFlags/service');

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/trainer/nutrition-plans', require('../src/routes/trainerNutritionPlans'));
app.use('/me/nutrition-plans', require('../src/routes/myNutritionPlans'));
// Mirrors the app-level error handler (err.status / err.body mapping).
app.use((err, req, res, next) => {
  if (err.body) return res.status(err.status || 500).json(err.body);
  res.status(err.status || 500).json({ error: err.message });
});

const T = 'tnut-trainer';
const C = 'tnut-client';
const OTHER = 'tnut-other';

let relationId;
let peanutIngredientId;
let riceIngredientId;
let planId;
let assignmentId;
let mealId;
let peanutItemId;
let teaItemId;

jest.setTimeout(60000);

async function cleanup() {
  await prisma.trainerNutritionFeedback.deleteMany({ where: { clientId: { in: [C, OTHER] } } });
  await prisma.trainerNutritionAssignment.deleteMany({ where: { clientId: { in: [C, OTHER] } } });
  await prisma.trainerNutritionPlan.deleteMany({ where: { trainer: { userId: { in: [T, OTHER] } } } });
  await prisma.trainerClientConsent.deleteMany({ where: { relation: { clientId: { in: [C, OTHER] } } } });
  await prisma.trainerDropForm.deleteMany({ where: { clientId: { in: [C, OTHER] } } });
  await prisma.trainerClient.deleteMany({ where: { clientId: { in: [C, OTHER] } } });
  await prisma.foodLog.deleteMany({ where: { userId: { in: [C, OTHER] } } });
  await prisma.userAllergy.deleteMany({ where: { userId: { in: [C, OTHER] } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [T, OTHER] } } });
  await prisma.trainerProfile.deleteMany({ where: { userId: { in: [T, OTHER] } } });
  await prisma.ingredient.deleteMany({ where: { normalizedName: { startsWith: 'tnut ' } } });
  await prisma.user.deleteMany({ where: { id: { in: [T, C, OTHER] } } });
}

async function grantConsent(category) {
  await prisma.trainerClientConsent.upsert({
    where: { relationId_category: { relationId, category } },
    update: { status: 'granted', grantedAt: new Date(), revokedAt: null },
    create: { relationId, category, status: 'granted', grantedAt: new Date() },
  });
}

beforeAll(async () => {
  await cleanup();
  for (const id of [T, C, OTHER]) {
    await prisma.user.create({ data: { id, email: `${id}@device.local` } });
  }
  const role = await prisma.role.findUnique({ where: { name: 'TRAINER' } });
  await prisma.userRole.create({ data: { userId: T, roleId: role.id } });
  const trainer = await prisma.trainerProfile.create({
    data: { userId: T, verified: true, active: true, applicationStatus: 'approved' },
  });
  const relation = await prisma.trainerClient.create({
    data: { trainerId: trainer.id, clientId: C, status: 'active' },
  });
  relationId = relation.id;

  const peanut = await prisma.allergy.upsert({ where: { name: 'Peanuts' }, update: {}, create: { name: 'Peanuts' } });
  await prisma.userAllergy.create({ data: { userId: C, allergyId: peanut.id } });

  const peanutIngredient = await prisma.ingredient.create({
    data: {
      name: 'Tnut Peanut Butter', normalizedName: 'tnut peanut butter',
      caloriesPer100g: 600, proteinPer100g: 25, carbsPer100g: 20, fatPer100g: 50, fiberPer100g: 6,
      source: 'test',
    },
  });
  peanutIngredientId = peanutIngredient.id;
  const rice = await prisma.ingredient.create({
    data: {
      name: 'Tnut Rice', normalizedName: 'tnut rice',
      caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3,
      source: 'test',
    },
  });
  riceIngredientId = rice.id;
  flags.resetCache();
});

afterAll(async () => {
  await cleanup();
});

const auth = (id) => ({ 'x-user-id': id });

describe('trainer nutrition plan lifecycle', () => {
  test('creates a draft with nested meals/items/targets', async () => {
    const res = await request(app).post('/trainer/nutrition-plans').set(auth(T)).send({
      title: 'Cut phase day',
      guidanceText: 'Keep protein high.',
      targets: { caloriesKcal: 2000, proteinG: 160, carbsG: 180, fatG: 65, fiberG: 30, waterMl: 2500 },
      meals: [
        {
          mealType: 'breakfast', timing: '08:00', notes: 'post-workout',
          items: [
            { ingredientId: peanutIngredientId, quantityG: 30, substitutions: { swap: 'almond butter' } },
            { foodName: 'Herbal tea', quantityG: 250 },
          ],
        },
        { mealType: 'lunch', items: [{ ingredientId: riceIngredientId, quantityG: 200 }] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.version).toBe(1);
    expect(res.body.meals).toHaveLength(2);
    expect(res.body.meals.find((m) => m.mealType === 'breakfast').items).toHaveLength(2);
    expect(res.body.targets.caloriesKcal).toBe(2000);
    expect(res.body.disclaimer).toMatch(/not medical nutrition therapy/i);
    planId = res.body.id;
    const breakfast = res.body.meals.find((m) => m.mealType === 'breakfast');
    mealId = breakfast.id;
    peanutItemId = breakfast.items.find((i) => i.ingredientId === peanutIngredientId).id;
    teaItemId = breakfast.items.find((i) => i.foodName === 'Herbal tea').id;
  });

  test('rejects drafts without title', async () => {
    const res = await request(app).post('/trainer/nutrition-plans').set(auth(T)).send({ meals: [] });
    expect(res.status).toBe(400);
  });

  test('rejects non-trainer callers', async () => {
    const res = await request(app).post('/trainer/nutrition-plans').set(auth(C)).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  test('updates draft children (replace-children)', async () => {
    const res = await request(app).patch(`/trainer/nutrition-plans/${planId}`).set(auth(T)).send({
      meals: [
        {
          mealType: 'breakfast', timing: '08:00', notes: 'post-workout',
          items: [
            { ingredientId: peanutIngredientId, quantityG: 30 },
            { foodName: 'Herbal tea', quantityG: 250 },
          ],
        },
        { mealType: 'lunch', items: [{ ingredientId: riceIngredientId, quantityG: 200 }] },
        { mealType: 'snack', items: [{ foodName: 'Apple', quantityG: 150 }] },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.meals).toHaveLength(3);
    expect(res.body.targets.caloriesKcal).toBe(2000); // preserved
    const breakfast = res.body.meals.find((m) => m.mealType === 'breakfast');
    mealId = breakfast.id;
    peanutItemId = breakfast.items.find((i) => i.ingredientId === peanutIngredientId).id;
    teaItemId = breakfast.items.find((i) => i.foodName === 'Herbal tea').id;
  });

  test('preview computes totals from ingredient nutrition; unresolvable items get nulls', async () => {
    const res = await request(app).get(`/trainer/nutrition-plans/${planId}/preview`).set(auth(T));
    expect(res.status).toBe(200);
    const breakfast = res.body.meals.find((m) => m.mealType === 'breakfast');
    const peanut = breakfast.items.find((i) => i.id === peanutItemId);
    expect(peanut.resolvable).toBe(true);
    expect(peanut.nutrition.calories).toBeCloseTo(180, 1); // 600 kcal/100g * 30g
    expect(peanut.nutrition.proteinG).toBeCloseTo(7.5, 2);
    const tea = breakfast.items.find((i) => i.id === teaItemId);
    expect(tea.resolvable).toBe(false);
    expect(tea.nutrition.calories).toBeNull();
    // incomplete plan: totals null where any item is unresolved, partialTotals kept
    expect(res.body.complete).toBe(false);
    expect(res.body.totals.calories).toBeNull();
    // 180 (peanut butter) + 260 (200g rice @130/100g) + 0 (apple has no data)
    expect(res.body.partialTotals.calories).toBeCloseTo(440, 1);
    expect(res.body.disclaimer).toMatch(/not medical nutrition therapy/i);
    // consent not yet granted — check skipped
    expect(res.body.allergyCheckConsent).toBe(false);
    expect(res.body.allergyConflicts).toEqual([]);
  });

  test('trainer sees own plans in list only', async () => {
    const res = await request(app).get('/trainer/nutrition-plans?status=draft').set(auth(T));
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p) => p.id)).toContain(planId);
  });

  test('plan detail hidden from non-owner trainers', async () => {
    const res = await request(app).get(`/trainer/nutrition-plans/${planId}`).set(auth(OTHER));
    expect([403, 404]).toContain(res.status); // OTHER isn't an approved trainer
  });

  test('publish requires a draft with items', async () => {
    const res = await request(app).post(`/trainer/nutrition-plans/${planId}/publish`).set(auth(T));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    const again = await request(app).post(`/trainer/nutrition-plans/${planId}/publish`).set(auth(T));
    expect(again.status).toBe(409);
  });
});

describe('assignment + allergy warnings', () => {
  test('assign is blocked before publish-state consent check without relation', async () => {
    const res = await request(app).post(`/trainer/nutrition-plans/${planId}/assign`).set(auth(T)).send({ clientId: OTHER });
    expect(res.status).toBe(403); // OTHER has no active relation
  });

  test('assign warns about allergy conflicts once consent granted; items never dropped', async () => {
    await grantConsent('food_logs');
    const res = await request(app).post(`/trainer/nutrition-plans/${planId}/assign`).set(auth(T)).send({ clientId: C });
    expect(res.status).toBe(201);
    expect(res.body.allergyCheckConsent).toBe(true);
    expect(res.body.allergyConflicts.length).toBeGreaterThan(0);
    const conflict = res.body.allergyConflicts.find((c) => c.itemId === peanutItemId);
    expect(conflict).toBeDefined();
    expect(conflict.allergen).toBe('Peanuts');
    expect(conflict.item).toMatch(/peanut butter/i);
    assignmentId = res.body.assignment.id;
    expect(res.body.assignment.status).toBe('assigned');

    // conflicting item still on the plan
    const detail = await request(app).get(`/trainer/nutrition-plans/${planId}`).set(auth(T));
    expect(detail.body.meals.flatMap((m) => m.items).some((i) => i.id === peanutItemId)).toBe(true);

    // preview now surfaces the same warning
    const preview = await request(app).get(`/trainer/nutrition-plans/${planId}/preview`).set(auth(T));
    expect(preview.body.allergyCheckConsent).toBe(true);
    expect(preview.body.allergyConflicts.some((c) => c.itemId === peanutItemId)).toBe(true);
  });

  test('duplicate open assignment rejected', async () => {
    const res = await request(app).post(`/trainer/nutrition-plans/${planId}/assign`).set(auth(T)).send({ clientId: C });
    expect(res.status).toBe(409);
  });

  test('client sees assignment, responds accept, gives feedback', async () => {
    const list = await request(app).get('/me/nutrition-plans').set(auth(C));
    expect(list.status).toBe(200);
    expect(list.body.assignments.map((a) => a.id)).toContain(assignmentId);

    const detail = await request(app).get(`/me/nutrition-plans/${assignmentId}`).set(auth(C));
    expect(detail.status).toBe(200);
    expect(detail.body.plan.meals.length).toBeGreaterThan(0);
    // client view: own allergy data, always computed
    expect(detail.body.allergyConflicts.some((c) => c.allergen === 'Peanuts')).toBe(true);

    const respond = await request(app).post(`/me/nutrition-plans/${assignmentId}/respond`).set(auth(C)).send({ action: 'accept' });
    expect(respond.status).toBe(200);
    expect(respond.body.assignment.status).toBe('accepted');

    const fb = await request(app).post(`/me/nutrition-plans/${assignmentId}/feedback`).set(auth(C)).send({ rating: 5, note: 'looks good' });
    expect(fb.status).toBe(201);
    expect(fb.body.feedback.rating).toBe(5);
  });

  test('another user cannot read or respond to the assignment', async () => {
    const res = await request(app).get(`/me/nutrition-plans/${assignmentId}`).set(auth(OTHER));
    expect(res.status).toBe(404);
    const respond = await request(app).post(`/me/nutrition-plans/${assignmentId}/respond`).set(auth(OTHER)).send({ action: 'accept' });
    expect(respond.status).toBe(404);
  });
});

describe('client meal logging — the only FoodLog write path', () => {
  test('plan lifecycle never auto-writes FoodLog or MacroGoal', async () => {
    // a second plan through the full lifecycle still leaves logs untouched
    const before = await prisma.foodLog.count({ where: { userId: C } });
    const create = await request(app).post('/trainer/nutrition-plans').set(auth(T)).send({
      title: 'No auto log plan',
      meals: [{ mealType: 'dinner', items: [{ ingredientId: riceIngredientId, quantityG: 100 }] }],
    });
    const publish = await request(app).post(`/trainer/nutrition-plans/${create.body.id}/publish`).set(auth(T));
    expect(publish.status).toBe(200);
    const assign = await request(app).post(`/trainer/nutrition-plans/${create.body.id}/assign`).set(auth(T)).send({ clientId: C });
    expect(assign.status).toBe(201);
    const after = await prisma.foodLog.count({ where: { userId: C } });
    expect(after).toBe(before);
    expect(await prisma.macroGoal.findUnique({ where: { userId: C } })).toBeNull();
    await prisma.trainerNutritionAssignment.delete({ where: { id: assign.body.assignment.id } });
  });

  test('logging a suggested ingredient item creates own FoodLog w/ trainer_plan source', async () => {
    const res = await request(app).post(`/me/nutrition-plans/${assignmentId}/log`).set(auth(C)).send({
      mealId,
      items: [{ itemId: peanutItemId, quantityG: 50 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.logs).toHaveLength(1);
    const log = res.body.logs[0];
    expect(log.userId).toBe(C);
    expect(log.mealType).toBe('breakfast');
    expect(log.ingredientId).toBe(peanutIngredientId);
    expect(log.calories).toBeCloseTo(300, 1); // 600/100g * 50g
    expect(log.nutritionSnapshot.source).toBe('trainer_plan');
    expect(log.nutritionSnapshot.trainerPlanId).toBe(planId);
    const inDb = await prisma.foodLog.findUnique({ where: { id: log.id } });
    expect(inDb.userId).toBe(C);
  });

  test('foodName-only items need macro overrides; others can be omitted', async () => {
    // logging the whole meal fails: herbal tea has no resolvable nutrition
    const fail = await request(app).post(`/me/nutrition-plans/${assignmentId}/log`).set(auth(C)).send({ mealId });
    expect(fail.status).toBe(400);
    expect(fail.body.items.some((i) => i.itemId === teaItemId)).toBe(true);
    expect(await prisma.foodLog.count({ where: { userId: C, nutritionSnapshot: { path: ['trainerMealId'], equals: mealId } } }))
      .toBe(1); // only the earlier explicit log — nothing written on failure

    const ok = await request(app).post(`/me/nutrition-plans/${assignmentId}/log`).set(auth(C)).send({
      mealId,
      items: [
        { itemId: peanutItemId },
        { itemId: teaItemId, calories: 2, proteinG: 0, carbsG: 0.4, fatG: 0 },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.logs).toHaveLength(2);
  });
});

describe('consent-gated trainer progress view', () => {
  test('no nutrition summary without consent; summary appears once granted', async () => {
    await prisma.trainerClientConsent.updateMany({
      where: { relationId, status: 'granted' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    const without = await request(app).get(`/trainer/nutrition-plans/clients/${C}/progress`).set(auth(T));
    expect(without.status).toBe(200);
    expect(without.body.nutritionSummary).toBeUndefined();
    expect(without.body.assignments.some((a) => a.id === assignmentId)).toBe(true);

    await grantConsent('nutrition_summaries');
    const withConsent = await request(app).get(`/trainer/nutrition-plans/clients/${C}/progress`).set(auth(T));
    expect(withConsent.status).toBe(200);
    expect(withConsent.body.nutritionSummary).toBeDefined();
    expect(withConsent.body.nutritionSummary.trainerPlanLogs).toBe(3); // 1 + 2 logged above
    expect(withConsent.body.grantedCategories).toContain('nutrition_summaries');
  });
});

describe('revise + archive', () => {
  test('revise creates version+1 draft superseding the archived original', async () => {
    const res = await request(app).post(`/trainer/nutrition-plans/${planId}/revise`).set(auth(T)).send({});
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(2);
    expect(res.body.supersedesId).toBe(planId);
    expect(res.body.status).toBe('draft');
    expect(res.body.meals.length).toBe(3); // children cloned
    const old = await request(app).get(`/trainer/nutrition-plans/${planId}`).set(auth(T));
    expect(old.body.status).toBe('archived');
    const archive = await request(app).post(`/trainer/nutrition-plans/${res.body.id}/archive`).set(auth(T));
    expect(archive.status).toBe(200);
    expect(archive.body.status).toBe('archived');
  });
});

describe('feature flag enforcement', () => {
  const flags2 = require('../src/services/featureFlags/service');
  const { envOverrideName } = require('../src/config/featureRegistry');
  const set = (k, v) => { process.env[envOverrideName(k)] = v; flags2.resetCache(); };

  test('flag off => 403 FEATURE_DISABLED on both routers', async () => {
    set('trainer_nutrition_guidance_enabled', 'false');
    const t = await request(app).get('/trainer/nutrition-plans').set(auth(T));
    expect(t.status).toBe(403);
    expect(t.body.error.code).toBe('FEATURE_DISABLED');
    const m = await request(app).get('/me/nutrition-plans').set(auth(C));
    expect(m.status).toBe(403);
    expect(m.body.error.code).toBe('FEATURE_DISABLED');
    set('trainer_nutrition_guidance_enabled', 'true');
  });

  test('parent flag off => child resolves off even when env-enabled', async () => {
    set('trainer_advanced_features_enabled', 'false');
    const res = await request(app).get('/trainer/nutrition-plans').set(auth(T));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    set('trainer_advanced_features_enabled', 'true');
  });
});
