// pc-HUM-91 — LEO-06 nutrition domain tools: ADD_GROCERY + LOG_RECIPE intents,
// measurement-safety contract (no 1ml=1g), grocery merge/undo semantics.
// Real prisma on the disposable fitness_test DB — no mocked persistence.
const express = require('express');
const request = require('supertest');
const { getPrisma } = require('../src/lib/prisma');
jest.mock('../src/services/aiProvider', () => ({ askJSON: jest.fn(), aiEnabled: () => false }));
const { envOverrideName } = require('../src/config/featureRegistry');

const prisma = getPrisma();
const app = express();
app.use(express.json());
app.use('/voice', require('../src/routes/voice'));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

const U = 'n9191-user';
const H = { 'x-user-id': U };
const R = 'n9191-dal-tadka';
const ING = 'n9191-test-oats';
const cid = () => `n9191-${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  ['voice_food_logging', 'voice_exercise_logging'].forEach(k => { process.env[envOverrideName(k)] = 'true'; });
  require('../src/services/featureFlags/service').resetCache();
  await prisma.user.upsert({ where: { id: U }, update: {}, create: { id: U, email: `${U}@test.dev` } });
  await prisma.user.upsert({ where: { id: 'n9191-other' }, update: {}, create: { id: 'n9191-other', email: 'n9191-other@test.dev' } });
  await prisma.recipe.upsert({
    where: { recipeName: 'n9191 Dal Tadka' }, update: {},
    // Batch totals over 800 g cooked yield, 4 servings → 200 g + 125 kcal each,
    // fiber 20/4 = 5 g per serving (measured, not null).
    create: { id: R, recipeName: 'n9191 Dal Tadka', creatorId: 'n9191-system', isSystem: true, reviewStatus: 'SYSTEM', servings: 4, portionG: 800, calories: 500, proteinG: 36, carbsG: 60, fatG: 12, fiberG: 20 },
  });
  await prisma.ingredient.upsert({
    where: { id: ING }, update: {},
    create: { id: ING, name: 'n9191 Test Oats', normalizedName: 'n9191 test oats', caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66, fatPer100g: 6.9, fiberPer100g: 10.6, source: 'test' },
  });
});

afterAll(async () => {
  const step = fn => fn().catch(() => null);
  await step(() => prisma.foodLog.deleteMany({ where: { userId: U } }));
  await step(() => prisma.groceryItem.deleteMany({ where: { userId: U } }));
  await step(() => prisma.voiceCommand.deleteMany({ where: { userId: U } }));
  await step(() => prisma.recipe.delete({ where: { id: R } }));
  await step(() => prisma.recipe.deleteMany({ where: { recipeName: { startsWith: 'n9191 ' } } }));
  await step(() => prisma.user.delete({ where: { id: 'n9191-other' } }));
  await step(() => prisma.ingredient.delete({ where: { id: ING } }));
  await step(() => prisma.user.delete({ where: { id: U } }));
  await prisma.$disconnect();
});

const interpret = (transcript) => request(app).post('/voice/interpret').set(H).send({ transcript });
const execute = (commandId, actions) => request(app).post('/voice/commands/execute').set(H).send({ commandId, transcript: 'test', actions });
const undo = (commandId) => request(app).post('/voice/commands/undo').set(H).send({ commandId });

describe('ADD_GROCERY — grocery domain tool', () => {
  test('parses "add milk and eggs to my grocery list" as grocery, not food', async () => {
    const res = await interpret('add milk and eggs to my grocery list');
    expect(res.status).toBe(200);
    const a = res.body.actions[0];
    expect(a.intent).toBe('ADD_GROCERY');
    expect(a.status).toBe('ready');
    expect(a.entities.items.map(i => i.name)).toEqual(['milk', 'eggs']);
  });

  test('executes to real GroceryItem rows; mass units become amountG, counts keep unitLabel', async () => {
    const res = await execute(cid(), [{ intent: 'ADD_GROCERY', status: 'ready', entities: { items: [
      { name: 'n9191 rice', amountG: 2000, unitLabel: null },
      { name: 'n9191 tofu', amountG: null, unitLabel: '2 pack' },
      { name: 'n9191 spinach', amountG: null, unitLabel: null },
    ] } }]);
    expect(res.status).toBe(201);
    expect(res.body.result[0].status).toBe('saved');
    const rows = await prisma.groceryItem.findMany({ where: { userId: U, normalizedName: { startsWith: 'n9191' } }, orderBy: { name: 'asc' } });
    expect(rows).toHaveLength(3);
    const rice = rows.find(r => r.name === 'n9191 rice');
    expect(rice.amountG).toBe(2000);
    const tofu = rows.find(r => r.name === 'n9191 tofu');
    expect(tofu.unitLabel).toBe('2 pack');
    expect(tofu.amountG).toBeNull(); // counted, never gram-converted
    const createdKinds = res.body.createdEntities.map(e => e.kind);
    expect(createdKinds).toEqual(['groceryItem', 'groceryItem', 'groceryItem']);
  });

  test('merge sums amountG on same pending row; undo restores prior amount', async () => {
    await prisma.groceryItem.create({ data: { userId: U, name: 'n9191 oats', normalizedName: 'n9191 oats', amountG: 100, status: 'pending' } });
    const id = cid();
    const res = await execute(id, [{ intent: 'ADD_GROCERY', status: 'ready', entities: { items: [{ name: 'n9191 oats', amountG: 50 }] } }]);
    const row = await prisma.groceryItem.findFirst({ where: { userId: U, name: 'n9191 oats' } });
    expect(row.amountG).toBe(150); // merged, not duplicated
    expect(res.body.createdEntities[0].kind).toBe('groceryItemMerge');
    const undoRes = await undo(id);
    expect(undoRes.status).toBe(200);
    const after = await prisma.groceryItem.findUnique({ where: { id: row.id } });
    expect(after.amountG).toBe(100); // merge rolled back, row not deleted
  });
});

describe('LOG_RECIPE — recipe domain tool', () => {
  test('parses "log the n9191 dal tadka recipe for dinner" and resolves the match', async () => {
    const res = await interpret('log the n9191 dal tadka recipe for dinner');
    const a = res.body.actions[0];
    expect(a.intent).toBe('LOG_RECIPE');
    expect(a.entities.recipeName).toBe('n9191 dal tadka');
    expect(a.entities.mealType).toBe('dinner');
    expect(a.status).toBe('ready'); // single catalog match resolved at interpret
    expect(a.entities.recipeId).toBe(R);
  });

  test('executes one serving: batch totals / servings, measured fiber preserved', async () => {
    const res = await execute(cid(), [{ intent: 'LOG_RECIPE', status: 'ready', entities: { recipeId: R, servings: 1, mealType: 'dinner' } }]);
    expect(res.status).toBe(201);
    expect(res.body.result[0].status).toBe('saved');
    const log = await prisma.foodLog.findFirst({ where: { userId: U, foodName: 'n9191 Dal Tadka' } });
    expect(log.quantityG).toBe(200);          // 800 g yield / 4 servings
    expect(log.calories).toBe(125);           // 500 / 4
    expect(log.fiberG).toBe(5);               // 20 / 4 — measured value, not dropped
    expect(log.mealType).toBe('dinner');
    expect(log.nutritionSnapshot.loggedSource).toBe('voice-recipe');
    expect(log.nutritionSnapshot.recipeId).toBe(R);
  });

  test('two servings scales both grams and nutrients', async () => {
    const res = await execute(cid(), [{ intent: 'LOG_RECIPE', status: 'ready', entities: { recipeId: R, servings: 2, mealType: 'lunch' } }]);
    expect(res.body.result[0].status).toBe('saved');
    const log = await prisma.foodLog.findFirst({ where: { userId: U, quantityG: 400 } });
    expect(log).toBeTruthy();
    expect(log.fiberG).toBe(10);
  });

  test('a client-supplied recipeId belonging to another user is rejected server-side', async () => {
    const other = await prisma.recipe.upsert({ where: { recipeName: 'n9191 private curry' }, update: { creatorId: 'n9191-other', isSystem: false, reviewStatus: 'SYSTEM' }, create: { recipeName: 'n9191 private curry', creatorId: 'n9191-other', isSystem: false, servings: 1, portionG: 300, calories: 300 } });
    const res = await execute(cid(), [{ intent: 'LOG_RECIPE', status: 'ready', entities: { recipeId: other.id, servings: 1, mealType: 'meal' } }]);
    expect(res.body.result[0]).toMatchObject({ status: 'skipped', reason: 'recipe not found or not yours' });
    await prisma.recipe.delete({ where: { id: other.id } });
  });

  test('REJECTED recipes cannot be voice-logged even when they match the name', async () => {
    const bad = await prisma.recipe.upsert({ where: { recipeName: 'n9191 rejected stew' }, update: { creatorId: U, isSystem: false, reviewStatus: 'REJECTED', servings: 1, portionG: 300 }, create: { recipeName: 'n9191 rejected stew', creatorId: U, isSystem: false, reviewStatus: 'REJECTED', servings: 1, portionG: 300, calories: 300 } });
    const res = await execute(cid(), [{ intent: 'LOG_RECIPE', status: 'ready', entities: { recipeId: bad.id, servings: 1, mealType: 'meal' } }]);
    expect(res.body.result[0].status).toBe('skipped');
    await prisma.recipe.delete({ where: { id: bad.id } });
  });
});

describe('measurement safety — P10 contract', () => {
  test('volume units never convert to grams: ml-based action is skipped, no log', async () => {
    const res = await execute(cid(), [{ intent: 'LOG_FOOD', status: 'ready', entities: { items: [{ name: 'n9191 test oats', quantity: 250, unit: 'ml', grams: null }], mealType: 'lunch' } }]);
    // Even a hand-built 'ready' action cannot fabricate grams from ml —
    // no catalog serving match → skipped, never 1ml=1g.
    expect(res.body.result[0].status).toBe('skipped');
    const logs = await prisma.foodLog.count({ where: { userId: U, foodName: { contains: 'oats' } } });
    expect(logs).toBe(0);
  });

  test('interpret flags an unmatched household unit needs_review rather than guessing', async () => {
    const res = await interpret('ate 3 thimbles of n9191 test oats');
    const a = res.body.actions[0];
    expect(a.intent).toBe('LOG_FOOD');
    expect(a.status).toBe('needs_review');
    // Executing a needs_review action is refused — the safety gate holds end-to-end.
    const exec = await execute(cid(), [a]);
    expect(exec.body.result[0].status).toBe('skipped');
    expect(exec.body.result[0].reason).toBe('needs_review');
  });
});
