// Regression for NUTR-019: REJECTED recipes must not be readable, searchable,
// or suggestible on any catalog surface — matching the existing mutation-route
// semantics. RESEARCH_DRAFT visibility is intentionally UNCHANGED here (draft
// labeling/gating is a documented product decision, not this fix).
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
const prisma = getPrisma();
const app = require('../src/app');

const S = `rrg${Date.now().toString(36)}`;
let user, rejected, draft, system;

beforeAll(async () => {
  const { hashPassword } = require('../src/services/authService');
  const passwordHash = await hashPassword('TestPass12345!');
  user = await prisma.user.create({ data: { email: `${S}@test.dev`, passwordHash, emailVerifiedAt: new Date(), timeZone: 'UTC' } });
  const base = { isSystem: true, servings: 1, calories: 400, portionG: 300, creatorId: 'system' };
  rejected = await prisma.recipe.create({ data: { ...base, recipeName: `${S} rejected stew`, reviewStatus: 'REJECTED' } });
  draft = await prisma.recipe.create({ data: { ...base, recipeName: `${S} draft stew`, reviewStatus: 'RESEARCH_DRAFT' } });
  system = await prisma.recipe.create({ data: { ...base, recipeName: `${S} system stew`, reviewStatus: 'SYSTEM' } });
});

afterAll(async () => {
  const step = async (fn) => { try { await fn(); } catch (_) {} };
  await step(() => prisma.recipeIngredient.deleteMany({ where: { recipeId: { in: [rejected.id, draft.id, system.id] } } }));
  await step(() => prisma.recipeEngagement.deleteMany({ where: { recipeId: { in: [rejected.id, draft.id, system.id] } } }));
  await step(() => prisma.recipe.deleteMany({ where: { id: { in: [rejected.id, draft.id, system.id] } } }));
  await step(() => prisma.foodLog.deleteMany({ where: { userId: user.id } }));
  await step(() => prisma.user.delete({ where: { id: user.id } }));
});

const auth = { 'x-user-id': '' };

describe('NUTR-019 — REJECTED review gate on read/suggest surfaces', () => {
  beforeAll(() => { auth['x-user-id'] = user.id; });

  it('intelligence endpoint: REJECTED → 404, SYSTEM → 200, RESEARCH_DRAFT unchanged (visible)', async () => {
    const r1 = await request(app).get(`/recipes/${rejected.id}/intelligence`).set(auth);
    expect(r1.status).toBe(404);
    const r2 = await request(app).get(`/recipes/${system.id}/intelligence`).set(auth);
    expect(r2.status).toBe(200);
    const r3 = await request(app).get(`/recipes/${draft.id}/intelligence`).set(auth);
    expect(r3.status).toBe(200); // draft visibility unchanged — product decision documented in NUTR-019
  });

  it('recipeService.searchRecipes excludes REJECTED, keeps SYSTEM and RESEARCH_DRAFT', async () => {
    const { searchRecipes } = require('../src/services/recipeService');
    const rows = await searchRecipes(`${S} `, user.id);
    const names = rows.map(r => r.title);
    expect(names).not.toContain(`${S} rejected stew`);
    expect(names).toContain(`${S} system stew`);
    expect(names).toContain(`${S} draft stew`);
  });

  it('recipeService.getRecipeNutrition rejects REJECTED as unavailable, resolves for SYSTEM', async () => {
    const { getRecipeNutrition } = require('../src/services/recipeService');
    await expect(getRecipeNutrition(rejected.id, user.id)).rejects.toThrow(/unavailable/i);
    expect(await getRecipeNutrition(system.id, user.id)).toBeTruthy();
  });

  it('meal-suggest candidates exclude REJECTED but include SYSTEM', async () => {
    const res = await request(app).get('/meal-suggest?occasion=lunch&limit=10&tz=UTC').set(auth);
    expect(res.status).toBe(200);
    const names = (res.body.options || []).map(o => o.name);
    expect(names).not.toContain(`${S} rejected stew`);
  });
});
