#!/usr/bin/env node
// pc-HUM-51 Workstream B — canonical serving-coverage recount + conversion-validity audit.
// READ-ONLY. Never mutates. Denominator is explicit; no hidden games.
//
// Definitions (the contract):
//   denominator  = all catalog Ingredients
//   verified     = serving rows with estimated=false AND traceable source provenance
//   traceable    = sourceRecord carries a documented source: usda/fdc id, manufacturer
//                  citation, documented measurement, or an Indian reference citation
//   unsupported  = serving rows lacking any traceable source — counted, never silently
//                  trusted; resolution requires a trustworthy source, never fabrication
//   implausible  = grams non-finite, <= 0, or > 5000 (consumed-portion policy bound)
//   compat-risk  = servings referenced by historical FoodLog nutritionSnapshot.servingId
//                  — deletion of these without a compat strategy violates key acceptance
//
// Usage: node scripts/serving-coverage-audit.js [--json out.json]
const TRACEABLE_KEYS = ['fdcId', 'usda', 'manufacturer', 'measurement', 'citation', 'reference', 'source', 'ifct', ' nutritent', 'nutritent'];

function classifyServing(row) {
  const reasons = [];
  const g = Number(row.grams);
  if (!Number.isFinite(g) || g <= 0 || g > 5000) reasons.push('implausible-grams');
  const sr = row.sourceRecord;
  const trace = sr && typeof sr === 'object' &&
    (TRACEABLE_KEYS.some((k) => sr[k] != null && sr[k] !== '' && sr[k] !== false) ||
     (Array.isArray(sr.sources) && sr.sources.length > 0));
  if (!trace) reasons.push('unsupported');
  if (reasons.includes('implausible-grams')) return { cls: 'implausible', reasons };
  if (!row.estimated && trace) return { cls: 'verified', reasons };
  if (row.estimated && trace) return { cls: 'estimated-traceable', reasons };
  return { cls: reasons.includes('implausible-grams') ? 'implausible' : 'unsupported', reasons };
}

async function run(prisma, { jsonOut } = {}) {
  const ingredients = await prisma.ingredient.findMany({ select: { id: true, name: true, source: true } });
  const servings = await prisma.ingredientServing.findMany();
  const logs = await prisma.foodLog.findMany({ select: { nutritionSnapshot: true } });
  const referenced = new Map(); // servingId -> count of historical references
  for (const l of logs) {
    const sid = l.nutritionSnapshot && l.nutritionSnapshot.servingId;
    if (sid) referenced.set(String(sid), (referenced.get(String(sid)) || 0) + 1);
  }
  const byIng = new Map();
  const tally = { verified: 0, 'estimated-traceable': 0, unsupported: 0, implausible: 0 };
  const unsupportedRows = []; const implausibleRows = [];
  for (const s of servings) {
    const { cls } = classifyServing(s);
    tally[cls] += 1;
    if (!byIng.has(s.ingredientId)) byIng.set(s.ingredientId, []);
    byIng.get(s.ingredientId).push(cls);
    if (cls === 'unsupported') unsupportedRows.push({ id: s.id, ingredientId: s.ingredientId, label: s.label });
    if (cls === 'implausible') implausibleRows.push({ id: s.id, ingredientId: s.ingredientId, label: s.label, grams: s.grams });
  }
  const servingIds = new Set(servings.map((s) => s.id));
  const compatRisk = [...referenced.entries()].map(([sid, count]) => ({ servingId: sid, references: count, exists: servingIds.has(sid) }));
  const missingReferenced = compatRisk.filter((r) => !r.exists);
  const denom = ingredients.length;
  const withVerified = ingredients.filter((i) => (byIng.get(i.id) || []).includes('verified')).length;
  const withAny = ingredients.filter((i) => (byIng.get(i.id) || []).length > 0).length;
  const report = {
    denominator: { definition: 'all catalog ingredients', count: denom },
    coverage: {
      withVerifiedServing: { count: withVerified, pct: denom ? +(100 * withVerified / denom).toFixed(1) : 0 },
      withAnyServing: { count: withAny, pct: denom ? +(100 * withAny / denom).toFixed(1) : 0 },
    },
    servingRows: { total: servings.length, ...tally },
    compat: {
      referencedServings: compatRisk.length,
      missingButReferenced: missingReferenced.length,
      detail: missingReferenced.slice(0, 50),
      note: 'servings referenced by historical FoodLogs must never be deleted without a compat strategy',
    },
    unsupportedRows: unsupportedRows.slice(0, 200),
    implausibleRows: implausibleRows.slice(0, 100),
    provenanceGaps: { unsupportedCount: unsupportedRows.length, implausibleCount: implausibleRows.length },
  };
  if (jsonOut) require('fs').writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`denominator: ${denom} catalog ingredients`);
  console.log(`verified coverage: ${withVerified}/${denom} (${report.coverage.withVerifiedServing.pct}%) | any-serving: ${withAny}/${denom} (${report.coverage.withAnyServing.pct}%)`);
  console.log(`serving rows: ${servings.length} total — verified ${tally.verified}, estimated-traceable ${tally['estimated-traceable']}, unsupported ${tally.unsupported}, implausible ${tally.implausible}`);
  console.log(`compat: ${compatRisk.length} servings referenced by historical FoodLogs; ${missingReferenced.length} referenced-but-missing`);
  return report;
}

if (require.main === module) {
  const { getPrisma } = require('../src/lib/prisma');
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  run(getPrisma(), { jsonOut }).then((r) => { console.log(r.provenanceGaps.unsupportedCount ? `AUDIT: ${r.provenanceGaps.unsupportedCount} unsupported conversions queued for source-backed resolution` : 'AUDIT: zero unsupported conversions'); process.exit(0); })
    .catch((e) => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
}
module.exports = { run, classifyServing };
