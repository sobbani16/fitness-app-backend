#!/usr/bin/env node
// HUM-34 §7 — contract-compat matrix: every mobile-client API call matched
// against the backend route inventory. The critical failure mode is a mobile
// call hitting a path the backend does not serve (integration break); the
// inverse direction is informational (web/admin/internal consumers exist).
// Usage: node scripts/generate-contract-compat-matrix.js [mobileApiDir]
const fs = require('fs');
const path = require('path');

const inv = require('../docs/api-contract-inventory.json');
const MOBILE_API = process.argv[2] || path.join(__dirname, '../../fitness-app-mobile/src/api');

const norm = (p) => p
  .replace(/\$\{[^}]+\}/g, '{}')   // mobile template params
  .replace(/:[^/]+/g, '{}')        // backend express params
  .replace(/\/+$/, '')
  .toLowerCase();

function extractMobileCalls(dir) {
  const calls = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // request<T>({ url: '/x' ... }) — GET by default unless method given
    for (const m of src.matchAll(/request(?:<[^>]*>)?\(\{\s*url:\s*['`]([^'"`]+)['`]([\s\S]{0,200}?)\}\s*\)/g)) {
      const mm = m[2].match(/method:\s*['`](\w+)['`]/);
      calls.push({ file: f, method: (mm ? mm[1] : 'GET').toUpperCase(), path: m[1] });
    }
    // api.get/post/put/delete/patch('/x' ...)
    for (const m of src.matchAll(/api\.(get|post|put|delete|patch)(?:<[^>]*>)?\(\s*['`]([^'"`]+)['`]/g)) {
      calls.push({ file: f, method: m[1].toUpperCase(), path: m[2] });
    }
  }
  return calls;
}

const backend = new Map();
for (const r of inv.routes) backend.set(`${r.method} ${norm(r.path)}`, r);

// Mobile tracks main, not this branch — classify unmatched calls by whether
// MAIN serves them (branch lag) vs genuinely missing (integration break).
// Main's app is introspected live in-memory; nothing is written there.
function walkRouter(handle, prefix, out) {
  for (const layer of handle.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((mm) => mm !== '_all');
      const routePath = layer.route.path === '/' ? '' : layer.route.path;
      for (const mm of methods) out.push({ mount: prefix, method: mm.toUpperCase(), path: routePath || '/' });
    } else if (layer.name === 'router' && layer.handle) {
      const src = (layer.regexp && layer.regexp.source) || '';
      const m = src.match(/^\^\\\/(.+?)\\\/\?\(\?=/) || src.match(/^\^\\\/([^\\?]+)/);
      const mount = m ? '/' + m[1].replace(/\\\//g, '/').replace(/\/?$/, '') : '';
      walkRouter(layer.handle, (prefix + mount).replace(/\/+$/, ''), out);
    }
  }
}
function scanMain(mainRoot) {
  const rows = [];
  try {
    const app = require(path.join(mainRoot, 'src/app'));
    walkRouter({ stack: (app._router && app._router.stack) || [] }, '', rows);
  } catch (e) {
    return null; // main checkout unavailable — matrix degrades to branch-only
  }
  const set = new Set();
  for (const r of rows) set.add(`${r.method} ${norm((r.mount + (r.path === '/' ? '' : r.path)).replace(/\/+/g, '/') || '/')}`);
  return set;
}
const mainBackend = scanMain(path.join(__dirname, '../../fitness-app-backend'));

const mobileCalls = extractMobileCalls(MOBILE_API);
const rows = [];
const seen = new Set();
for (const c of mobileCalls) {
  const key = `${c.method} ${norm(c.path)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  let status;
  if (backend.has(key)) status = 'MATCHED';
  else if (mainBackend && mainBackend.has(key)) status = 'MATCHED_MAIN_ONLY_BRANCH_LAG';
  else if (mainBackend === null) status = 'UNVERIFIED_MAIN_UNAVAILABLE';
  else status = 'UNMATCHED_BACKEND_MISSING';
  rows.push({ method: c.method, path: c.path, consumer: c.file, backend: status });
}

const unmatched = rows.filter((r) => r.backend === 'UNMATCHED_BACKEND_MISSING');
const lag = rows.filter((r) => r.backend === 'MATCHED_MAIN_ONLY_BRANCH_LAG');
const matrix = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-contract-compat-matrix.js',
  backendInventory: 'docs/api-contract-inventory.json',
  mobileApiDir: path.relative(process.cwd(), MOBILE_API),
  totals: {
    mobileCalls: rows.length,
    matched: rows.filter((r) => r.backend === 'MATCHED').length,
    matchedMainOnlyBranchLag: lag.length,
    unmatchedBackendMissing: unmatched.length,
  },
  rows,
  notes: [
    'UNMATCHED_BACKEND_MISSING = mobile client calls a path absent from the backend inventory — integration break or inventory blind spot.',
    'Backend routes with no mobile consumer are not listed: web/admin/internal surfaces exist.',
    'Response-shape compat is verified per-endpoint by contract tests (e.g. fiberMobileContract) — this matrix covers method+path existence.',
  ],
};
const out = path.join(__dirname, '../docs/contract-compat-matrix.json');
fs.writeFileSync(out, JSON.stringify(matrix, null, 2));
console.log(`mobile calls: ${rows.length} matched: ${rows.filter((r) => r.backend === 'MATCHED').length} branch-lag: ${lag.length} genuinely-missing: ${unmatched.length}`);
for (const u of unmatched.slice(0, 40)) console.log(`UNMATCHED ${u.method} ${u.path} (${u.consumer})`);
