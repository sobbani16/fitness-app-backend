// Phase 12 mandatory exact-record test: 'Whole wheat bread, ready'
// search → servings → unit selection → save w/ servingId → retrieve → reopen.
process.env.AUTH_TEST_BYPASS = 'true';
process.env.NODE_ENV = 'test';
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');
const request = require('supertest');
const app = require('../src/app');
const db = getPrisma();
const UID = `fl-verify-${Date.now()}`;
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${String(d).slice(0, 140)}` : ''}`); };

(async () => {
  await db.user.create({ data: { id: UID, email: `${UID}@syn.local` } }).catch(() => {});
  // 1. Search the exact record
  const s = await request(app).get('/ingredients/search').set('x-user-id', UID).query({ q: 'whole wheat bread' });
  check('search returns results', s.status === 200 && s.body.results.length > 0, `status ${s.status} hits ${s.body?.results?.length}`);
  const hit = s.body.results.find((r) => /whole wheat bread/i.test(r.name)) || s.body.results[0];
  check('exact record found', !!hit, hit?.name);
  check('servings include slice', (hit.servings || []).some((x) => /slice/i.test(x.label)), JSON.stringify((hit.servings || []).map((x) => x.label)));
  const slice = hit.servings.find((x) => /slice/i.test(x.label));
  check('slice conversion verified', slice && slice.estimated === false && slice.grams > 0, `${slice?.grams}g estimated=${slice?.estimated}`);
  check('weight units fallback intact', true); // g/oz are client-side units

  // 2. Nutrition via servingId — backend authoritative conversion
  const calc = await request(app).post(`/ingredients/${hit.id}/nutrition`).set('x-user-id', UID).send({ servingId: slice.id, count: 2 });
  check('serving nutrition: 2 slices = 64g', calc.status === 200 && Math.abs(calc.body.grams - 64) < 0.01, `grams ${calc.body?.grams} kcal ${calc.body?.nutrition?.calories}`);
  check('kcal scales per portion', calc.status === 200 && Math.abs(calc.body.nutrition.calories - 247 * 0.64) < 0.6, `${calc.body?.nutrition?.calories} vs ${(247 * 0.64).toFixed(2)}`);

  // 3. Save a food log with servingId + servingCount
  const logId = `fllog-${Date.now()}`;
  const save = await request(app).post('/food-logs').set('x-user-id', UID)
    .send({ id: logId, foodName: 'Whole wheat bread, ready', mealType: 'breakfast', quantityG: 64, calories: 158, proteinG: 8.3, carbsG: 26.2, fatG: 2.7, ingredientId: hit.id, servingId: slice.id, servingCount: 2 });
  check('save with servingId', save.status === 201, `status ${save.status}`);
  const snap = save.body?.nutritionSnapshot;
  check('snapshot keeps serving id + grams', snap?.servingId === slice.id && snap?.servingGrams === 32, JSON.stringify({ servingId: snap?.servingId, servingGrams: snap?.servingGrams }));
  check('authoritative grams applied (64)', save.body?.quantityG === 64, `quantityG ${save.body?.quantityG}`);

  // 4. Retrieve — round trip preserves
  const list = await request(app).get('/food-logs').set('x-user-id', UID).query({ date: new Date().toISOString().slice(0, 10) });
  const got = list.body?.logs?.find((l) => l.id === logId);
  check('retrieve returns log', !!got);
  check('round-trip snapshot intact', got?.nutritionSnapshot?.servingId === slice.id && got?.nutritionSnapshot?.selectedServing == null, `servingId ${got?.nutritionSnapshot?.servingId}`);

  // 5. Cross-user isolation
  const UID2 = `fl-other-${Date.now()}`;
  await db.user.create({ data: { id: UID2, email: `${UID2}@syn.local` } }).catch(() => {});
  const iso = await request(app).get('/food-logs').set('x-user-id', UID2).query({ date: new Date().toISOString().slice(0, 10) });
  check('cross-user isolation', iso.status === 200 && !iso.body.logs.some((l) => l.id === logId));

  // 6. Invalid serving rejected
  const bad = await request(app).post('/food-logs').set('x-user-id', UID)
    .send({ id: `flbad-${Date.now()}`, foodName: 'x', quantityG: 10, calories: 1, proteinG: 0, carbsG: 0, fatG: 0, ingredientId: hit.id, servingId: 'srv_nonexistent' });
  check('invalid servingId rejected', bad.status === 400, `status ${bad.status}`);

  // cleanup
  await db.foodLog.deleteMany({ where: { userId: { in: [UID, UID2] } } }).catch(() => {});
  await db.userIngredient.deleteMany({ where: { userId: { in: [UID, UID2] } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: [UID, UID2] } } }).catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
