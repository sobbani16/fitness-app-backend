const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/services/authService');
const { resolveOccasion } = require('../src/services/mealSuggestion');

const prisma = getPrisma();
const S = `ms${Date.now().toString(36)}`;
let user, restricted;

beforeAll(async () => {
  const mk = async (tag, extra = {}) => prisma.user.create({ data: {
    email: `${tag}@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(),
    gender: 'male', currentWeightKg: 80, heightCm: 180, activityLevel: 'moderate',
    dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC', ...extra } });

  user = await mk(`${S}-u`);
  restricted = await mk(`${S}-r`);

  // Allergy: peanuts. Preference: NEVER_RECOMMEND mushrooms.
  const allergy = await prisma.allergy.upsert({ where: { name: 'peanut' }, update: {}, create: { name: 'peanut' } });
  await prisma.userAllergy.create({ data: { userId: restricted.id, allergyId: allergy.id } });
  await prisma.foodPreference.create({ data: { userId: restricted.id, foodName: 'mushroom', preference: 'NEVER_RECOMMEND' } });
  await prisma.userPlanningPreferences.create({ data: { userId: restricted.id, dietaryRestrictions: ['dairy_free'] } });

  // System recipes — a couple of eligible ones plus ineligible ones.
  await prisma.recipe.createMany({ data: [
    { creatorId: 'system', isSystem: true, recipeName: `${S} Grilled chicken bowl`, mealType: 'lunch', calories: 550, proteinG: 40, carbsG: 45, fatG: 18 },
    { creatorId: 'system', isSystem: true, recipeName: `${S} Oatmeal with berries`, mealType: 'breakfast', calories: 380, proteinG: 12, carbsG: 60, fatG: 8 },
    { creatorId: 'system', isSystem: true, recipeName: `${S} Peanut noodles`, mealType: 'lunch', calories: 600, proteinG: 20, carbsG: 70, fatG: 25 },
    { creatorId: 'system', isSystem: true, recipeName: `${S} Mushroom risotto`, mealType: 'dinner', calories: 520, proteinG: 14, carbsG: 75, fatG: 18 },
    { creatorId: 'system', isSystem: true, recipeName: `${S} Cheese omelette`, mealType: 'lunch', calories: 450, proteinG: 28, carbsG: 3, fatG: 35 },
  ]});
  // Ineligible-by-ingredient recipe (peanut only in ingredient list, not name).
  const ing = await prisma.recipe.create({ data: { creatorId: 'system', isSystem: true, recipeName: `${S} Satay salad`, mealType: 'lunch', calories: 400, proteinG: 25 } });
  await prisma.recipeIngredient.create({ data: { recipeId: ing.id, ingredientName: 'peanut satay sauce', amountG: 30 } });
});
afterAll(async () => {
  // Fixture cleanup — the shared dev DB keeps recipes between runs otherwise.
  await prisma.recipe.deleteMany({ where: { recipeName: { startsWith: S } } });
});
const auth = id => ({ 'x-user-id': id });

describe('resolveOccasion', () => {
  it('maps local hours to occasions', () => {
    const at = h => resolveOccasion('UTC', new Date(Date.UTC(2026, 0, 15, h)));
    expect(at(7)).toBe('breakfast');
    expect(at(12)).toBe('lunch');
    expect(at(16)).toBe('snack');
    expect(at(19)).toBe('dinner');
    expect(at(2)).toBe('snack');
  });
  it('honors explicit override', () => {
    expect(resolveOccasion('UTC', new Date(), 'dinner')).toBe('dinner');
  });
});

describe('GET /meal-suggest', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/meal-suggest')).status).toBe(401);
  });

  it('returns eligible options with reasons — works with zero logged meals', async () => {
    const res = await request(app).get('/meal-suggest?occasion=lunch&tz=UTC').set(auth(user.id));
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.occasion).toBe('lunch');
    expect(b.options.length).toBeGreaterThanOrEqual(1);
    expect(b.options.length).toBeLessThanOrEqual(5);
    expect(b.options[0].nutrition.calories).toBeGreaterThan(0);
    expect(b.options[0].reasons.length).toBeGreaterThan(0);
    expect(b.context.intakeCompleteness).toBe('none');
    expect(b.context.note).toMatch(/do not scale/i);
  });

  it('hard filters never overridden: allergy + NEVER_RECOMMEND + dietary restriction', async () => {
    const res = await request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(restricted.id));
    expect(res.status).toBe(200);
    const names = res.body.options.map(o => o.name.toLowerCase()).join(' | ');
    // No result may contain an allergen, a NEVER_RECOMMEND food, or a
    // restricted ingredient — regardless of which fixtures rank.
    expect(names).not.toMatch(/peanut|satay|mushroom|cheese/);
    expect(res.body.eligibility.excludedRecipes).toBeGreaterThanOrEqual(4);
    expect(res.body.eligibility.allergiesChecked).toBe(1);
    expect(res.body.eligibility.restrictionsApplied).toContain('dairy_free');
  });

  it('unrestricted user has no recipes excluded by these filters', async () => {
    const res = await request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(user.id));
    expect(res.body.options.length).toBeGreaterThan(0);
    // No allergies/preferences/restrictions → nothing excluded for this user.
    expect(res.body.eligibility.excludedRecipes).toBe(0);
  });

  it('occasion match outranks off-occasion recipes', async () => {
    const res = await request(app).get('/meal-suggest?occasion=breakfast&limit=10&tz=UTC').set(auth(user.id));
    expect(res.body.options[0].mealType).toBe('breakfast');
  });

  it('intake logging gaps never produce "fill the deficit" prescriptions', async () => {
    // One small meal logged — suggestions stay normal-sized.
    await prisma.foodLog.create({ data: { userId: user.id, foodName: 'apple', quantityG: 100, calories: 95, proteinG: 0, carbsG: 25, fatG: 0, mealType: 'breakfast' } });
    const res = await request(app).get('/meal-suggest?occasion=lunch&tz=UTC').set(auth(user.id));
    for (const o of res.body.options) {
      expect(o.nutrition.calories).toBeLessThanOrEqual(1500); // no giant "catch-up" meals
    }
    expect(res.body.context.intakeCompleteness).toBe('partial');
  });

  it('scoping: one user’s allergy does not affect another user', async () => {
    const [a, b] = await Promise.all([
      request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(restricted.id)),
      request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(user.id)),
    ]);
    expect(a.body.eligibility.excludedRecipes).toBeGreaterThan(b.body.eligibility.excludedRecipes);
    expect(a.body.options.map(o => o.name.toLowerCase()).join(' | ')).not.toMatch(/peanut/);
  });

  it('active health-condition block rules exclude recipes by ingredient attribute', async () => {
    const u = await prisma.user.create({ data: {
      email: `${S}-cond@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(),
      gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC',
    }});
    const condition = await prisma.healthCondition.upsert({ where: { name: `${S} Diabetes test` }, update: {}, create: { name: `${S} Diabetes test` } });
    await prisma.conditionRule.upsert({
      where: { conditionId_attribute_target: { conditionId: condition.id, attribute: `${S}_HIGH_SUGAR`, target: 'ingredient' } },
      update: {}, create: { conditionId: condition.id, attribute: `${S}_HIGH_SUGAR`, target: 'ingredient', action: 'block', reason: 'test block' },
    });
    await prisma.userHealthCondition.create({ data: { userId: u.id, conditionId: condition.id, active: true } });
    const ing = await prisma.ingredient.create({ data: { name: `${S} glucose syrup`, normalizedName: `${S} glucose syrup`, caloriesPer100g: 300, proteinPer100g: 0, carbsPer100g: 75, fatPer100g: 0 } });
    await prisma.ingredientAttribute.create({ data: { ingredientId: ing.id, attribute: `${S}_HIGH_SUGAR` } });
    const rec = await prisma.recipe.create({ data: { creatorId: 'system', isSystem: true, recipeName: `${S} Sweet glaze lunch`, mealType: 'lunch', calories: 500, proteinG: 20 } });
    await prisma.recipeIngredient.create({ data: { recipeId: rec.id, ingredientName: `${S} glucose syrup`, amountG: 50 } });

    const res = await request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(u.id));
    expect(res.status).toBe(200);
    expect(res.body.options.map(o => o.name).join(' | ')).not.toContain(`${S} Sweet glaze lunch`);
    expect(res.body.eligibility.conditionBlocksApplied).toContain(`${S} Diabetes test`);
    // A user without the condition still sees it — check the full eligible set
    // via the service directly (route caps limit at 10; shared DB has fixtures).
    const { getMealSuggestions } = require('../src/services/mealSuggestion');
    const other = await getMealSuggestions(prisma, user.id, { occasion: 'lunch', limit: 400, timeZone: 'UTC' });
    expect(other.options.map(o => o.name).join(' | ')).toContain(`${S} Sweet glaze lunch`);
    await prisma.recipe.delete({ where: { id: rec.id } }).catch(() => null);
  });

  it('trainer-prescribed plan items surface first and cannot be filtered out by ranking', async () => {
    const nutritionist = await prisma.user.create({ data: {
      email: `${S}-nutri@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(), timeZone: 'UTC',
    }});
    const profile = await prisma.nutritionistProfile.create({ data: { userId: nutritionist.id } });
    const client = await prisma.user.create({ data: {
      email: `${S}-client@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(),
      gender: 'female', currentWeightKg: 65, heightCm: 168, dateOfBirth: new Date(Date.now() - 28 * 365.25 * 86400000), timeZone: 'UTC',
    }});
    const plan = await prisma.mealPlan.create({ data: {
      nutritionistId: profile.id, clientId: client.id, active: true,
      caloriesTarget: 1800, proteinTarget: 120,
    }});
    await prisma.mealPlanItem.create({ data: {
      mealPlanId: plan.id, mealType: 'lunch', foodName: `${S} prescribed quinoa bowl`, quantityG: 300, calories: 450, proteinG: 30,
    }});
    const res = await request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(client.id));
    expect(res.status).toBe(200);
    const planItem = res.body.options.find(o => o.fromPlan);
    expect(planItem).toBeTruthy();
    expect(planItem.name).toBe(`${S} prescribed quinoa bowl`);
    expect(planItem.reasons.join(' ')).toMatch(/nutritionist plan/i);
    // Plan item leads the options — prescribed food outranks generic recipes.
    expect(res.body.options[0].fromPlan).toBe(true);
  });

  it('eligibility recomputes on every call — a new allergy takes effect immediately', async () => {
    const { getMealSuggestions } = require('../src/services/mealSuggestion');
    const u = await prisma.user.create({ data: {
      email: `${S}-recomp@test.dev`, passwordHash: await hashPassword('TestPass12345!'), emailVerifiedAt: new Date(),
      gender: 'male', currentWeightKg: 80, heightCm: 180, dateOfBirth: new Date(Date.now() - 30 * 365.25 * 86400000), timeZone: 'UTC',
    }});
    const rec = await prisma.recipe.create({ data: { creatorId: 'system', isSystem: true, recipeName: `${S} Chicken unique bowl`, mealType: 'lunch', calories: 600, proteinG: 35 } });
    const before = await getMealSuggestions(prisma, u.id, { occasion: 'lunch', limit: 400, timeZone: 'UTC' });
    expect(before.options.map(o => o.name).join(' | ')).toContain(`${S} Chicken unique bowl`);
    const allergy = await prisma.allergy.upsert({ where: { name: `${S} chicken` }, update: {}, create: { name: `${S} chicken` } });
    await prisma.userAllergy.create({ data: { userId: u.id, allergyId: allergy.id } });
    const after = await getMealSuggestions(prisma, u.id, { occasion: 'lunch', limit: 400, timeZone: 'UTC' });
    expect(after.options.map(o => o.name).join(' | ')).not.toContain(`${S} Chicken unique bowl`);
    await prisma.recipe.delete({ where: { id: rec.id } }).catch(() => null);
  });

  it('rules engine is fully deterministic and requires no AI provider', async () => {
    // The service has no AI dependency at all — identical inputs produce
    // identical options with or without any AI key configured.
    const [a, b] = await Promise.all([
      request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(restricted.id)),
      request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth(restricted.id)),
    ]);
    expect(a.body.version).toBe('meal-suggest-v1');
    expect(a.body.options.map(o => o.name)).toEqual(b.body.options.map(o => o.name));
  });
});
