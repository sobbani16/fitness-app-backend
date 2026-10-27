const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/fitness_catalog_')) throw Error('Dedicated localhost fitness_catalog_* database required');
process.env.NODE_ENV = 'test';
const { getPrisma } = require('../src/lib/prisma');
const { importCatalog, validateCatalog, nutrition } = require('../src/services/ingredientCatalog');
const { searchIngredients } = require('../src/services/ingredientService');
const usda = require('../src/services/usdaService');
const rows = require('../data/humai-ingredients.json'), db = getPrisma();
(async () => {
 try {
  const count = await db.ingredientCatalog.count();
  const dry = await importCatalog(db, rows); assert.equal(await db.ingredientCatalog.count(), count); assert.equal(dry.usable, 212);
  await importCatalog(db, rows, true);
  const original = await db.ingredient.findMany({ where: { catalogId: { not: null } }, orderBy: { id: 'asc' } });
  await Promise.all([importCatalog(db, rows, true), importCatalog(db, rows, true)]);
  assert.equal(await db.ingredientCatalog.count(), 684); assert.equal(await db.ingredient.count({ where: { catalogId: { not: null } } }), 212);
  assert.deepEqual((await db.ingredient.findMany({ where: { catalogId: { not: null } }, orderBy: { id: 'asc' } })).map(x => x.id), original.map(x => x.id));
  usda.setFetch(async () => { throw Error('External API must not run for catalog matches'); });
  for (const query of ['bajra', 'SAJJALU', '  kambu ', 'pearl millet']) {
   const hits = await searchIngredients({ userId: randomUUID(), query }); assert.equal(hits[0].catalogId, 'IFCT-A003');
   assert.equal(hits[0].macrosPer100g.carbs_g, 73.27); assert.equal(hits[0].macrosPer100g.fiber_g, 11.49);
  }
  for (const { row, usable } of validateCatalog(rows)) {
   if (usable) {
    const hits = await searchIngredients({ userId: 'fixture', query: row.name }); assert.equal(hits[0].catalogId, row.id);
    assert.equal(hits[0].caloriesPer100g, nutrition(row).caloriesPer100g);
   }
  }
  const client = await db.user.create({ data: { email: `${randomUUID()}@example.test` } });
  try {
   let upstreamCalls = 0;
   usda.setFetch(async () => { upstreamCalls++; return { ok: true, json: async () => ({ foods: [{ fdcId: 999999999, description: 'Fixture outside catalog', foodNutrients: [{ nutrientName: 'Energy', unitName: 'KCAL', value: 123 }] }] }) }; });
   const fallback = await searchIngredients({ userId: client.id, query: 'fixture outside catalog' });assert.equal(fallback[0].source, 'usda');assert.equal(upstreamCalls, 1);
   const repeat = await searchIngredients({ userId: client.id, query: 'fixture outside catalog' });assert.equal(repeat[0].id, fallback[0].id);assert.equal(upstreamCalls, 1);
   await db.ingredient.delete({ where: { id: fallback[0].id } });
  } finally { await db.user.delete({ where: { id: client.id } }); }
  const modified = structuredClone(rows); modified[2].kcal_per_100g += 1;
  await importCatalog(db, modified, true);assert.equal((await db.ingredient.findUnique({ where: { catalogId: 'IFCT-A003' } })).caloriesPer100g, modified[2].kcal_per_100g);
  const pending = structuredClone(modified);pending[2].status = 'NEEDS_SOURCE_MATCH';await importCatalog(db,pending,true);
  usda.setFetch(async()=>({ok:true,json:async()=>({foods:[]})}));assert.equal((await searchIngredients({userId:'fixture',query:'sajjalu'})).length,0);
  await importCatalog(db, rows, true);
  await assert.rejects(importCatalog(db,[rows[0],rows[0]],true), /Duplicate/);
  assert.equal(await db.ingredientCatalog.count(),684);
  console.log('PASS: preview, repeat/concurrent imports, stable IDs, all 212 exact names, aliases/case/ranking, nutrition/fiber, hidden candidates, updates, validation and USDA fallback/cache');
 } finally { await db.$disconnect(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
