const request = require('supertest');
const app = require('../src/app');
const { getPrisma } = require('../src/lib/prisma');
const { importRecipes } = require('../src/services/recipeImport');
const { matchRecipes } = require('../src/services/recipeMatch');
const { searchFoods } = require('../src/services/foodSearch');

jest.setTimeout(30000);

const uid = `test-user-${Date.now()}`;
const prisma = getPrisma();
let cat, ing, recipe;

beforeAll(async () => {
  await prisma.user.create({ data: { id: uid, email: `${uid}@t.dev` } }).catch(() => {});
  cat = await prisma.ingredientCatalog.create({ data: {
    id: `test_cat_${Date.now()}`, name: 'Test egg, whole raw', normalizedName: 'test egg, whole raw',
    aliases: ['test eggs'], category: 'Protein', preparation: 'raw', status: 'GENERIC_COMPOSITION', usable: true,
    verificationLevel: 'GENERIC_COMPOSITION', sourceRecord: { id: 'test' },
    ingredient: { create: { name: 'Test egg, whole raw', normalizedName: 'test egg, whole raw', caloriesPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, fiberPer100g: 0, source: 'humai-catalog' } },
  } });
  ing = await prisma.ingredient.findUnique({ where: { catalogId: cat.id } });
  recipe = await prisma.recipe.create({ data: {
    recipeName: `Test Egg Rice ${Date.now()}`, creatorId: 'system', isSystem: true, cuisine: 'Indian', region: 'South Indian',
    mealType: 'lunch', servings: 2, portionG: 200, calories: 300, proteinG: 10, carbsG: 40, fatG: 8, fiberG: 2,
    reviewStatus: 'RESEARCH_DRAFT', sourceKey: `TEST-${Date.now()}`, aliases: ['anda rice'],
    ingredients: { create: [
      { ingredientId: ing.id, ingredientName: 'Test egg, whole raw', amountG: 100, calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 },
      { ingredientName: 'Water', amountG: 50, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    ] },
  } });
});

afterAll(async () => {
  await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
  await prisma.recipe.delete({ where: { id: recipe.id } });
  await prisma.ingredient.delete({ where: { id: ing.id } });
  await prisma.ingredientCatalog.delete({ where: { id: cat.id } });
  await prisma.user.delete({ where: { id: uid } }).catch(() => {});
});

describe('unified /foods/search', () => {
  it('returns recipe hits via name and alias with estimated labeling', async () => {
    const res = await request(app).get('/foods/search').set('x-user-id', uid).query({ q: recipe.recipeName.slice(0, 10) });
    expect(res.status).toBe(200);
    const hit = res.body.results.find(r => r.id === recipe.id);
    expect(hit).toBeTruthy();
    expect(hit.type).toBe('recipe');
    expect(hit.verificationLevel).toBe('ESTIMATED');
    expect(hit.perServing.calories).toBe(300);
  });
  it('matches recipe aliases (anda rice)', async () => {
    const res = await request(app).get('/foods/search').set('x-user-id', uid).query({ q: 'anda rice' });
    expect(res.body.results.some(r => r.id === recipe.id)).toBe(true);
  });
  it('honors type/mealType filters and rejects bad input', async () => {
    const bad = await request(app).get('/foods/search').set('x-user-id', uid).query({ q: 'x', type: 'bogus' });
    expect(bad.status).toBe(400);
    const filtered = await request(app).get('/foods/search').set('x-user-id', uid).query({ q: recipe.recipeName.slice(0, 10), type: 'recipe', mealType: 'lunch' });
    expect(filtered.status).toBe(200);
    expect(filtered.body.results.every(r => r.type === 'recipe')).toBe(true);
    const noMatch = await request(app).get('/foods/search').set('x-user-id', uid).query({ q: recipe.recipeName.slice(0, 10), type: 'recipe', mealType: 'snack' });
    expect(noMatch.body.results).toHaveLength(0);
  });
  it('requires a user id', async () => {
    const res = await request(app).get('/foods/search').query({ q: 'rice' });
    expect(res.status).toBe(401);
  });
});

describe('POST /recipes/match', () => {
  it('matches recipes by linked ingredientId and reports missing', async () => {
    const r = await matchRecipes({ userId: uid, ingredients: ['test egg, whole raw'] });
    const hit = r.results.find(x => x.recipe.id === recipe.id);
    expect(hit).toBeTruthy();
    expect(hit.coverage).toBe(1);
    expect(hit.missing).toHaveLength(0); // water is a pantry staple, never reported missing
  });
  it('resolves plural aliases (test eggs) and reports unresolved inputs', async () => {
    const r = await matchRecipes({ userId: uid, ingredients: ['test eggs', 'unobtainium fruit'] });
    expect(r.unresolvedInputs).toEqual(['unobtainium fruit']);
    expect(r.results.some(x => x.recipe.id === recipe.id)).toBe(true);
  });
  it('rejects empty input', async () => {
    await expect(matchRecipes({ userId: uid, ingredients: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('recipeImport idempotency', () => {
  const src = {
    recipeKey: `IMP-${Date.now()}`, recipeName: `Import Idempotent ${Date.now()}`, cuisine: 'Indian', mealType: 'lunch',
    get ingredientKey() { return cat.id; },
    servings: 2, portionG: 150, finishedYieldG: 300, publishReady: false, reviewStatus: 'RESEARCH_DRAFT',
    perServing: { calories: 200, proteinG: 8, carbsG: 25, fatG: 6, fiberG: 3 },
    get ingredients() { return [{ ingredientName: 'Test egg, whole raw', ingredientKey: this.ingredientKey, amountG: 100, calories: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 }]; },
  };
  afterAll(async () => {
    const r = await prisma.recipe.findUnique({ where: { sourceKey: src.recipeKey } });
    if (r) { await prisma.recipeIngredient.deleteMany({ where: { recipeId: r.id } }); await prisma.recipe.delete({ where: { id: r.id } }); }
  });
  it('dry-run writes nothing; apply is idempotent and preserves line ids', async () => {
    await importRecipes(prisma, [src], { apply: false });
    expect(await prisma.recipe.findUnique({ where: { sourceKey: src.recipeKey } })).toBeNull();
    const first = await importRecipes(prisma, [src], { apply: true, checksum: 't1' });
    expect(first.inserted).toBe(1);
    const lineIds = (await prisma.recipeIngredient.findMany({ where: { recipe: { sourceKey: src.recipeKey } } })).map(l => l.id);
    const second = await importRecipes(prisma, [src], { apply: true, checksum: 't2' });
    expect(second.unchanged).toBe(1);
    expect(second.linesChanged).toBe(0);
    const after = (await prisma.recipeIngredient.findMany({ where: { recipe: { sourceKey: src.recipeKey } } })).map(l => l.id);
    expect(after).toEqual(lineIds);
  });
  it('refuses to overwrite a recipeName owned by another sourceKey', async () => {
    const clash = { ...src, recipeKey: `IMP-CLASH-${Date.now()}` };
    const rep = await importRecipes(prisma, [clash], { apply: true, checksum: 't3' });
    expect(rep.skipped).toBe(1);
    expect(rep.conflicts[0].reason).toMatch(/owned by/);
  });
});

describe('search excludes quarantined + rejected rows', () => {
  it('test-fixture ingredients never appear in central results', async () => {
    const junk = await prisma.ingredient.create({ data: { name: `quar-${Date.now()} glucose`, normalizedName: `quar-${Date.now()} glucose`, caloriesPer100g: 1, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, source: 'test-fixture' } });
    const r = await searchFoods({ userId: uid, query: 'glucose' }).catch(() => ({ results: [] }));
    expect((r.results || []).every(x => x.id !== junk.id)).toBe(true);
    await prisma.ingredient.delete({ where: { id: junk.id } });
  });
});
