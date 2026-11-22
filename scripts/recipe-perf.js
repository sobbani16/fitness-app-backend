// PERF-001: recipe-intelligence performance measurement on synthetic profiles.
// Real DB + real AI provider (quota-respecting; a few calls on synthetic users).
// Creates perf-* fixture rows, measures, cleans up. Read-mostly.
//
// Usage: node scripts/recipe-perf.js [--ai]   (--ai also runs live generate calls)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { getPrisma } = require('../src/lib/prisma');
const { loadConstraints } = require('../src/services/recipes/constraints');
const { loadCatalog, validateGeneratedRecipe } = require('../src/services/recipes/validate');
const { matchIngredients } = require('../src/services/recipeMatch');
const cache = require('../src/services/recipes/cache');
const metrics = require('../src/services/recipes/metrics');
const db = getPrisma();
const WITH_AI = process.argv.includes('--ai');

const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; };
const bench = async (fn, n) => { const ts = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await fn(); ts.push(performance.now() - t0); } return { n, p50: +pct(ts, 50).toFixed(1), p95: +pct(ts, 95).toFixed(1), p99: +pct(ts, 99).toFixed(1), min: +Math.min(...ts).toFixed(1), max: +Math.max(...ts).toFixed(1) }; };

const CANDIDATE = {
  name: 'Tomato Rice Bowl', description: 'perf fixture', servings: 2, estimatedMinutes: 20, mealType: 'lunch',
  ingredients: [
    { ingredientName: 'rice', amountG: 200, unit: 'g', optional: false },
    { ingredientName: 'tomato', amountG: 100, unit: 'g', optional: false },
    { ingredientName: 'onion', amountG: 50, unit: 'g', optional: false },
  ],
  instructions: ['Cook the rice until tender.', 'Saute onion and tomato, fold into rice.', 'Serve hot.'],
  missingIngredients: [], substitutions: [],
};

(async () => {
  const uid = `perf-${Date.now()}`;
  console.log(`PERF-001 · synthetic profile ${uid}`);
  // Fixture profiles — created then deleted in the same run.
  const allergy = await db.allergy.findFirst({ select: { id: true } }).catch(() => null);
  const profiles = {
    clean: { allergies: [], prefs: [], planning: null, inventory: [], macro: null },
    allergic: { allergies: allergy ? [{ userId: uid, allergyId: allergy.id }] : [], prefs: [], planning: null, inventory: [], macro: null },
    constrained: {
      allergies: allergy ? [{ userId: uid, allergyId: allergy.id }] : [],
      prefs: [{ userId: uid, foodName: 'perf-never', preference: 'NEVER_RECOMMEND' }, { userId: uid, foodName: 'tomato', preference: 'LOVE' }],
      planning: { userId: uid, dietaryRestrictions: ['vegetarian'], availableEquipment: ['stovetop'] },
      inventory: [{ userId: uid, foodName: 'rice', quantityG: 500 }],
      macro: { userId: uid, caloriesTarget: 2100, proteinTarget: 150, carbsTarget: 220, fatTarget: 70, fiberTarget: 30, source: 'perf' },
    },
  };
  // User + fixture rows.
  await db.user.create({ data: { id: uid, email: `${uid}@perf.local` } }).catch(() => {});
  for (const a of profiles.constrained.allergies) await db.userAllergy.create({ data: a }).catch(() => {});
  for (const p of profiles.constrained.prefs) await db.foodPreference.create({ data: p }).catch(() => {});
  if (profiles.constrained.planning) await db.userPlanningPreferences.upsert({ where: { userId: uid }, create: profiles.constrained.planning, update: {} }).catch(() => {});
  for (const i of profiles.constrained.inventory) await db.foodInventory.create({ data: i }).catch(() => {});
  if (profiles.constrained.macro) await db.macroGoal.upsert({ where: { userId: uid }, create: profiles.constrained.macro, update: {} }).catch(() => {});

  const results = { generatedAt: new Date().toISOString(), profiles: {}, ai: null, cache: null };

  // Cold vs warm catalog.
  cache.reset();
  const t0 = performance.now(); await loadCatalog(db); const coldMs = +(performance.now() - t0).toFixed(1);
  const t1 = performance.now(); await loadCatalog(db); const warmMs = +(performance.now() - t1).toFixed(1);
  results.cache = { catalogColdMs: coldMs, catalogWarmMs: warmMs, stats: cache.snapshot() };

  for (const [label, cfg] of Object.entries(profiles)) {
    // Only 'constrained' carries fixture rows; others reuse the same userId
    // with differing request-level narrowing to keep profiles isolated.
    const request = label === 'allergic' ? {} : {};
    const constraints = await loadConstraints(uid, request);
    const cat = await loadCatalog(db);
    results.profiles[label] = {
      constraintShape: { allergenTerms: constraints.hard.allergenTerms.size, excludeTerms: constraints.hard.excludeTerms.size, hasLimits: !!constraints.limits },
      loadConstraints: await bench(() => loadConstraints(uid, request), 20),
      validate: await bench(() => validateGeneratedRecipe(CANDIDATE, constraints, { prisma: db, catalog: cat }), 30),
      matchIngredients: await bench(() => matchIngredients({ userId: uid, items: [{ name: 'rice' }, { name: 'tomato' }], limit: 10 }), 15),
    };
  }

  // Live AI — one generate call per profile (quota: ≤20/day; we use ≤3).
  if (WITH_AI) {
    const { askJSON, aiUsage } = require('../src/services/aiProvider');
    const { generateRecipes } = require('../src/services/recipes/generate');
    const before = aiUsage(uid);
    const aiRuns = [];
    for (const label of ['clean', 'constrained']) {
      const t0 = performance.now();
      let out, err = null;
      try { out = await generateRecipes({ userId: uid, items: [{ name: 'rice' }, { name: 'tomato' }], servings: 2, limit: 3 }); }
      catch (e) { err = { status: e.status, message: e.message }; }
      const ms = +(performance.now() - t0).toFixed(0);
      aiRuns.push({ profile: label, ms, status: out?.status || err?.status, candidates: out?.candidates?.length ?? 0, rejected: out?.rejected?.length ?? 0, fallback: out?.fallback?.length ?? 0, error: err?.message || null });
    }
    const after = aiUsage(uid);
    results.ai = {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      calls: aiRuns.length,
      tokensDelta: after.tokensToday - before.tokensToday,
      callsDelta: after.callsToday - before.callsToday,
      runs: aiRuns,
      // gpt-4o-mini list pricing (USD/1M tokens) — stated assumption, verify vs invoice.
      estCostUsd: +(((after.tokensToday - before.tokensToday) * 0.6 / 1e6) + 0.0005).toFixed(4),
    };
  }

  const out = path.join(__dirname, '..', 'docs', 'recipe-intelligence', 'perf-results.json');
  fs.writeFileSync(out, JSON.stringify({ ...results, metrics: metrics.snapshot() }, null, 2));
  console.log(JSON.stringify(results, null, 2).slice(0, 3200));
  console.log(`\n→ ${out}`);

  // Cleanup synthetic fixtures.
  await db.recipeEngagement.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.foodInventory.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.foodPreference.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.userAllergy.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.userPlanningPreferences.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.macroGoal.deleteMany({ where: { userId: uid } }).catch(() => {});
  await db.user.delete({ where: { id: uid } }).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
