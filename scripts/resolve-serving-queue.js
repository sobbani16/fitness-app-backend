#!/usr/bin/env node
// pc-HUM-51 — unresolved-serving-queue resolution tooling.
// READ-ONLY against the catalog; queries USDA FDC public API for published
// portion measures; emits an evidence-bound review file. NEVER writes the
// database, NEVER fabricates: items without FDC-published measures stay
// unresolved and are explicitly queued for human review with reasons.
//
// Discipline (per card): trustworthy sources only (USDA FDC here); licensing
// is US-government public domain; per-100g ≠ serving weight — only measures
// FDC actually publishes are captured; dry≠cooked and proxy discrimination is
// the reviewer's call, recorded not assumed.
//
// Usage: node scripts/resolve-serving-queue.js [--limit N] [--out evidence.json]
const PRIORITY_QUEUE = ['atta', 'cashew', 'basmati', 'paneer', 'soya', 'ragi', 'poha', 'gongura', 'tindora', 'water'];

function extractPortions(fdcDetail) {
  // Only measures FDC actually publishes — never derived, never assumed.
  return (fdcDetail.foodPortions || []).map((p) => ({
    unit: p.measureUnit?.name || null,
    amount: p.amount ?? null,
    gramWeight: p.gramWeight ?? null,
    modifier: p.modifier || null,
  })).filter((p) => Number.isFinite(p.gramWeight) && p.gramWeight > 0 && p.unit);
}

function assessItem(ingredient, searchHit, detail) {
  if (!searchHit) return { status: 'no-fdc-match', reason: 'no USDA FDC entry matched — stays unresolved, needs non-FDC trustworthy source (IFCT/manufacturer/documented measurement)' };
  const portions = detail ? extractPortions(detail) : [];
  if (!portions.length) return { status: 'no-published-portions', fdcId: searchHit.fdcId, dataType: detail?.dataType || null, reason: 'FDC entry exists but publishes no gram-weighted portions — per-100g ≠ serving weight, never derived' };
  return {
    status: 'evidence-found', fdcId: searchHit.fdcId, dataType: detail.dataType,
    fdcDescription: searchHit.description,
    portions,
    citation: `USDA FDC ${detail.dataType} fdcId ${searchHit.fdcId} — public domain (US government work)`,
    reviewRequired: true, // source association ≠ verification — reviewer gate per governance
    reviewNotes: 'verify name/prep match (dry vs cooked, exact species/variety) before acceptance',
  };
}

async function fdcJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FDC ${res.status}`);
  return res.json();
}

async function resolveItem(prisma, key, ing) {
  const q = encodeURIComponent(ing.name.replace(/\s*—\s*proxy\s*$/i, ''));
  const search = await fdcJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${q}&pageSize=1`);
  const hit = (search.foods || [])[0] || null;
  let detail = null;
  if (hit) {
    detail = await fdcJson(`https://api.nal.usda.gov/fdc/v1/food/${hit.fdcId}?api_key=${key}`);
    await new Promise((r) => setTimeout(r, 400)); // rate-limit courtesy
  }
  return { ingredientId: ing.id, ingredientName: ing.name, ...assessItem(ing, hit, detail) };
}

async function run(prisma, key, { limit = 40, out = null, queryFn = null } = {}) {
  const all = await prisma.ingredient.findMany({
    where: { servings: { none: {} } },
    select: { id: true, name: true }, orderBy: { name: 'asc' },
  });
  const prioritized = all.filter((i) => PRIORITY_QUEUE.some((p) => i.name.toLowerCase().includes(p)));
  const queue = (prioritized.length ? prioritized : all).slice(0, limit);
  const results = [];
  for (const ing of queue) {
    results.push(await (queryFn || resolveItem)(prisma, key, ing));
  }
  const tally = { 'evidence-found': 0, 'no-fdc-match': 0, 'no-published-portions': 0 };
  results.forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
  const report = {
    generatedAt: new Date().toISOString(), queueSize: queue.length, unresolvedTotal: all.length, tally,
    discipline: 'evidence-bound review file only — nothing applied; unverifiable rows stay unresolved, never fabricated',
    results,
  };
  if (out) require('fs').writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`queue: ${queue.length} prioritized of ${all.length} unresolved — evidence-found ${tally['evidence-found']}, no-fdc-match ${tally['no-fdc-match']}, no-published-portions ${tally['no-published-portions']}`);
  return report;
}

if (require.main === module) {
  require('dotenv').config();
  const key = process.env.USDA_API_KEY;
  if (!key) { console.error('USDA_API_KEY required'); process.exit(1); }
  const { getPrisma } = require('../src/lib/prisma');
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 40;
  run(getPrisma(), key, { limit, out }).then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
module.exports = { run, extractPortions, assessItem, PRIORITY_QUEUE };
