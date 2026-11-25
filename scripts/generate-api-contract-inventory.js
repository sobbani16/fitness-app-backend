// HUM-34 §3: enumerate every mounted route/method and classify the surface.
// Introspects the real Express app — the inventory cannot drift from runtime
// because the test suite regenerates and compares it.
// Usage: node scripts/generate-api-contract-inventory.js [--write]
const fs = require('fs');
const path = require('path');

// safetyFixtures throws in prod-like envs; ensure it loads as disabled/test.
process.env.NODE_ENV = 'test';
delete process.env.RAILWAY_ENVIRONMENT_NAME;
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/humai_test';

const INTERNAL_PREFIXES = ['/webhooks', '/test-fixtures', '/internal'];
const EXPERIMENTAL = ['/leo', '/pose', '/ai'];

function classify(mountPath) {
  if (INTERNAL_PREFIXES.some((p) => mountPath.startsWith(p))) return 'internal';
  if (EXPERIMENTAL.some((p) => mountPath.startsWith(p))) return 'experimental';
  return 'stable';
}

function mountOf(layer) {
  const src = (layer.regexp && layer.regexp.source) || '';
  const m = src.match(/^\^\\\/([^\\?]+)/);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/').replace(/\/?$/, '');
}

function walkRouter(handle, prefix, out) {
  for (const layer of handle.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((mm) => mm !== '_all');
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      for (const mm of methods) {
        out.push({ mount: prefix, method: mm.toUpperCase(), path: routePath || '/' });
      }
    } else if (layer.name === 'router' && layer.handle) {
      walkRouter(layer.handle, (prefix + mountOf(layer)).replace(/\/+$/, ''), out);
    }
  }
}

function walk(app) {
  const out = [];
  walkRouter({ stack: (app._router && app._router.stack) || [] }, '', out);
  return out;
}

const app = require('../src/app');
const rows = walk(app).map((r) => ({
  method: r.method,
  path: (r.mount + (r.path === '/' ? '' : r.path)).replace(/\/+/g, '/') || '/',
  surface: classify(r.mount),
}));
rows.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));

const inventory = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-api-contract-inventory.js',
  classification: {
    stable: 'public client contract — breaking changes need a deprecation window',
    experimental: 'gated/in-development surface — contracts may evolve behind flags',
    internal: 'non-client surface (webhooks, test fixtures, ops) — must never leak into client SDKs',
  },
  totals: {
    routes: rows.length,
    stable: rows.filter((r) => r.surface === 'stable').length,
    experimental: rows.filter((r) => r.surface === 'experimental').length,
    internal: rows.filter((r) => r.surface === 'internal').length,
  },
  routes: rows,
};

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'api-contract-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
  console.log(`wrote docs/api-contract-inventory.json — ${rows.length} routes (${inventory.totals.stable} stable, ${inventory.totals.experimental} experimental, ${inventory.totals.internal} internal)`);
} else {
  console.log(JSON.stringify(inventory.totals));
}
module.exports = { walk, classify };
