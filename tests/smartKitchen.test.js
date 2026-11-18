const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const { matchIngredients } = require('../src/services/recipeMatch');
const { computeFromLines } = require('../src/services/recipeImport');

jest.setTimeout(30000);

const uid = `sk-user-${Date.now()}`;
const prisma = getPrisma();
const T = Date.now();
let catEgg, catAvo, catBread, catButter, ingEgg, ingAvo, ingBread, recipe, recipeOpt;

beforeAll(async () => {
  await prisma.user.create({ data: { id: uid, email: `${uid}@t.dev` } }).catch(() => {});
  const mkCat = async (name, aliases, per100) => prisma.ingredientCatalog.create({ data: {
    id: `skc_${name.replace(/\W+/g, '_')}_${T}`, name, normalizedName: name,
    aliases, category: name.includes('bread') ? 'Bread' : 'Protein', preparation: 'ready',
    status: 'GENERIC_COMPOSITION', usable: true, verificationLevel: 'GENERIC_COMPOSITION',
    sourceRecord: { id: name },
    ingredient: { create: { name, normalizedName: name, source: 'humai-catalog', ...per100 } },
  } });
  catEgg = await mkCat(`sk egg ${T}`, ['sk eggs'], { caloriesPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, fiberPer100g: 0 });
  catAvo = await mkCat(`sk avocado ${T}`, [], { caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 8.5, fatPer100g: 14.7, fiberPer100g: 6.7 });
  catBread = await mkCat(`sk bread ${T}`, [], { caloriesPer100g: 265, proteinPer100g: 9, carbsPer100g: 49, fatPer100g: 3.2, fiberPer100g: 2.7 });
  catButter = await mkCat(`sk butter ${T}`, [], { caloriesPer100g: 717, proteinPer100g: 0.9, carbsPer100g: 0.1, fatPer100g: 81, fiberPer100g: 0 });
  const ingOf = (c) => prisma.ingredient.findUnique({ where: { catalogId: c.id } });
  ingEgg = await ingOf(catEgg); ingAvo = await ingOf(catAvo); ingBread = await ingOf(catBread); const ingButter = await ingOf(catButter);

  recipe = await prisma.recipe.create({ data: {
    recipeName: `Sk Avocado Egg Toast ${T}`, creatorId: 'system', isSystem: true, cuisine: 'American',
    mealType: 'breakfast', servings: 1, portionG: 190, prepMinutes: 10, reviewStatus: 'RESEARCH_DRAFT',
    sourceKey: `SK-${T}-a`, aliases: ['avo egg toast'],
    ingredients: { create: [
      { ingredientId: ingBread.id, ingredientName: catBread.name, amountG: 60 },
      { ingredientId: ingAvo.id, ingredientName: catAvo.name, amountG: 75 },
      { ingredientId: ingEgg.id, ingredientName: catEgg.name, amountG: 100, calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 },
      { ingredientId: ingButter.id, ingredientName: catButter.name, amountG: 5 },
      { ingredientName: 'Salt', amountG: 1 },
    ] },
  } });
  recipeOpt = await prisma.recipe.create({ data: {
    recipeName: `Sk Egg Sandwich ${T}`, creatorId: 'system', isSystem: true, cuisine: 'American',
    mealType: 'breakfast', servings: 1, portionG: 150, reviewStatus: 'RESEARCH_DRAFT', sourceKey: `SK-${T}-b`,
    ingredients: { create: [
      { ingredientId: ingBread.id, ingredientName: catBread.name, amountG: 60 },
      { ingredientId: ingEgg.id, ingredientName: catEgg.name, amountG: 100 },
      { ingredientName: 'Sk cheese', amountG: 25, optional: true },
    ] },
  } });
});

afterAll(async () => {
  for (const r of [recipe, recipeOpt].filter(Boolean)) {
    await prisma.recipeIngredient.deleteMany({ where: { recipeId: r.id } });
    await prisma.recipe.delete({ where: { id: r.id } }).catch(() => {});
  }
  for (const c of [catEgg, catAvo, catBread, catButter].filter(Boolean)) {
    const ing = await prisma.ingredient.findUnique({ where: { catalogId: c.id } }).catch(() => null);
    if (ing) await prisma.ingredient.delete({ where: { id: ing.id } }).catch(() => {});
    await prisma.ingredientCatalog.delete({ where: { id: c.id } }).catch(() => {});
  }
  await prisma.user.delete({ where: { id: uid } }).catch(() => {});
});

describe('matchIngredients v2', () => {
  it('eggs+avocado+bread → ready recipes, pantry salt never counted', async () => {
    const r = await matchIngredients({ userId: uid, items: [{ name: 'sk egg ' + T }, { name: 'sk avocado ' + T }, { name: 'sk bread ' + T }] });
    const hit = r.results.find((x) => x.recipe.id === recipe.id);
    expect(hit).toBeTruthy();
    // butter is a required line the user didn't name → missing-one; salt is pantry.
    expect(hit.status).toBe('missing-one');
    expect(hit.coverage).toBe(0.75); // 3 of 4 required lines (salt is pantry)
    expect(hit.missingRequired.map((m) => m.name)).toEqual([catButter.name]);
    expect(hit.missingRequired.some((m) => /salt/i.test(m.name))).toBe(false);
    expect(hit.quantityAssumed).toBe(true);
    expect(hit.reasons.length).toBeGreaterThan(0);
  });
  it('reports missing-one status and reason strings', async () => {
    const r = await matchIngredients({ userId: uid, items: [{ name: 'sk bread ' + T }, { name: 'sk egg ' + T }] });
    const hit = r.results.find((x) => x.recipe.id === recipeOpt.id);
    expect(hit.status).toBe('ready'); // cheese line is optional — never penalized
    expect(hit.missingOptional.map((m) => m.name)).toEqual(['Sk cheese']);
  });
  it('flags insufficient quantities only when user supplies amounts', async () => {
    const r = await matchIngredients({ userId: uid, items: [{ name: 'sk bread ' + T, amountG: 30 }, { name: 'sk egg ' + T, amountG: 500 }, { name: 'sk avocado ' + T, amountG: 100 }, { name: 'sk butter ' + T, amountG: 10 }] });
    const hit = r.results.find((x) => x.recipe.id === recipe.id);
    expect(hit.quantityAssumed).toBe(false);
    expect(hit.insufficientQuantities.some((i) => i.ingredientName === catBread.name && i.needG === 60 && i.haveG === 30)).toBe(true);
    expect(hit.status).toBe('insufficient-quantity');
  });
  it('excludes recipes by user allergies (recipe-level declared)', async () => {
    const flagged = await prisma.recipe.update({ where: { id: recipe.id }, data: { allergens: ['egg'] } });
    const r = await matchIngredients({ userId: uid, items: [{ name: 'sk egg ' + T }, { name: 'sk avocado ' + T }, { name: 'sk bread ' + T }], allergies: ['egg'] });
    expect(r.results.some((x) => x.recipe.id === recipe.id)).toBe(false);
    expect(r.excluded.allergy).toBeGreaterThanOrEqual(1);
    await prisma.recipe.update({ where: { id: flagged.id }, data: { allergens: [] } });
  });
  it('honors maxPrepMinutes', async () => {
    const items = [{ name: 'sk egg ' + T }, { name: 'sk avocado ' + T }, { name: 'sk bread ' + T }, { name: 'sk butter ' + T }];
    const r = await matchIngredients({ userId: uid, items, maxPrepMinutes: 5 });
    expect(r.results.some((x) => x.recipe.id === recipe.id)).toBe(false);
    expect(r.excluded.prepTime).toBeGreaterThanOrEqual(1);
  });
  it('resolves ingredientId + identityKey inputs', async () => {
    const r = await matchIngredients({ userId: uid, items: [{ ingredientId: ingEgg.id }, { name: 'sk bread ' + T }] });
    expect(r.results.some((x) => x.recipe.id === recipeOpt.id)).toBe(true);
  });
});

describe('POST /recipes/match-ingredients route', () => {
  it('returns v2 contract', async () => {
    const res = await request(app).post('/recipes/match-ingredients').set('x-user-id', uid)
      .send({ items: [{ name: 'sk bread ' + T }, { name: 'sk egg ' + T }], limit: 5 });
    expect(res.status).toBe(200);
    const hit = res.body.results.find((x) => x.recipe.id === recipeOpt.id);
    expect(hit.status).toBe('ready');
    expect(hit.recipe.prepMinutes === null || typeof hit.recipe.prepMinutes === 'number').toBe(true);
    expect(Array.isArray(hit.availableIngredients)).toBe(true);
    expect(Array.isArray(hit.missingRequired)).toBe(true);
    expect(Array.isArray(hit.reasons)).toBe(true);
  });
  it('rejects anonymous + empty', async () => {
    const res = await request(app).post('/recipes/match-ingredients').send({ items: [] });
    expect([400, 401]).toContain(res.status);
  });
});

describe('grocery list', () => {
  let item;
  it('adds, merges, updates, deletes items', async () => {
    const add = await request(app).post('/grocery').set('x-user-id', uid).send({ items: [{ name: 'Sk Butter 500g', amountG: 100 }, { name: 'SK butter 500g', amountG: 50 }] });
    expect(add.status).toBe(201);
    expect(add.body.items).toHaveLength(1); // merged by normalizedName
    item = add.body.items[0];
    expect(item.amountG).toBe(150);
    const patch = await request(app).patch(`/grocery/${item.id}`).set('x-user-id', uid).send({ status: 'purchased' });
    expect(patch.body.item.status).toBe('purchased');
    const list = await request(app).get('/grocery').set('x-user-id', uid).query({ status: 'purchased' });
    expect(list.body.items.some((i) => i.id === item.id)).toBe(true);
    const del = await request(app).delete(`/grocery/${item.id}`).set('x-user-id', uid);
    expect(del.status).toBe(200);
  });
  it('blocks cross-user access', async () => {
    const add = await request(app).post('/grocery').set('x-user-id', uid).send({ items: [{ name: 'Mine' }] });
    const res = await request(app).patch(`/grocery/${add.body.items[0].id}`).set('x-user-id', 'intruder').send({ status: 'purchased' });
    expect(res.status).toBe(404);
    await request(app).delete(`/grocery/${add.body.items[0].id}`).set('x-user-id', uid);
  });
});

describe('recipe engagement', () => {
  it('upserts favorite + rating + notes', async () => {
    const res = await request(app).put(`/recipes/${recipe.id}/engagement`).set('x-user-id', uid).send({ favorite: true, rating: 4, notes: 'good' });
    expect(res.status).toBe(200);
    expect(res.body.engagement.favorite).toBe(true);
    const res2 = await request(app).put(`/recipes/${recipe.id}/engagement`).set('x-user-id', uid).send({ rating: 2 });
    expect(res2.body.engagement.rating).toBe(2);
    expect(res2.body.engagement.favorite).toBe(true); // preserved
    const detail = await request(app).get(`/recipes/${recipe.id}`).set('x-user-id', uid);
    expect(detail.body.engagement.rating).toBe(2);
    expect(detail.body.instructions !== undefined).toBe(true);
  });
  it('rejects bad rating', async () => {
    const res = await request(app).put(`/recipes/${recipe.id}/engagement`).set('x-user-id', uid).send({ rating: 9 });
    expect(res.status).toBe(400);
  });
});

describe('computeFromLines nutrition', () => {
  it('computes per-serving macros from linked per-100g data', () => {
    const lines = [
      { ingredientName: 'X', amountG: 100, _per100: { calories: 200, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2 } },
      { ingredientName: 'Y', amountG: 50, _per100: { calories: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: null } },
    ];
    const out = computeFromLines(lines, { servings: 1, finishedYieldG: 150, portionG: 150 });
    expect(out.calories).toBe(250);
    expect(out.proteinG).toBe(12.5);
    expect(out.carbsG).toBe(25);
    expect(out.fatG).toBe(6);
    expect(out.fiberG).toBe(2); // only the line with fiber contributes — never invented
    expect(out._computedLines).toBe(2);
  });
  it('returns null when no scaling basis exists', () => {
    expect(computeFromLines([{ ingredientName: 'X', amountG: 10, _per100: null }], {})).toBeNull();
  });
});
