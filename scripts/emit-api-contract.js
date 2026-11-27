#!/usr/bin/env node
// Emits contracts/api-contract.json — the machine-readable cross-repo contract.
// CLI: `node scripts/emit-api-contract.js` writes; `--check` exits 1 on drift.
// Source of truth: app.js mounts + routes/index.js mounts + router.METHOD('path').
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ROUTES = path.join(ROOT, 'src/routes');
const OUT = path.join(ROOT, 'contracts/api-contract.json');

function join(base, p) {
  const out = ((base === '/' ? '' : base) + (p === '/' ? '' : p.startsWith('/') ? p : '/' + p)).replace(/\/{2,}/g, '/');
  return out.replace(/\/$/, '') || '/';
}

function collect() {
  const appJs = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const indexJs = fs.readFileSync(path.join(ROUTES, 'index.js'), 'utf8');
  const mounts = {};
  for (const m of appJs.matchAll(/app\.use\('([^']+)',\s*require\('\.\/routes\/([^']+)'\)\)/g)) (mounts[m[2]] ||= []).push(m[1]);
  for (const m of indexJs.matchAll(/router\.use\('([^']+)',\s*(?:require\('\.\/([^']+)'\)|(\w+)(?:\.router)?)\)/g)) (mounts[m[2] || m[3]] ||= []).push(m[1]);
  const versionSrc = fs.readFileSync(path.join(ROOT, 'src/config/version.js'), 'utf8');
  // Resolve nested mounts (e.g. router.use('/identities', require('./identities')) inside auth.js)
  // until fixpoint — parents must resolve before children.
  const files = fs.readdirSync(ROUTES).filter(f => f.endsWith('.js') && f !== 'index.js');
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (const file of files) {
      const name = file.replace(/\.js$/, '');
      const parentMounts = mounts[name];
      if (!parentMounts) continue;
      for (const m of fs.readFileSync(path.join(ROUTES, file), 'utf8').matchAll(/router\.use\('([^']+)',\s*require\('\.\/([^']+)'\)\)/g)) {
        for (const b of parentMounts) {
          const resolved = join(b, m[1]);
          if (!(mounts[m[2]] ||= []).includes(resolved)) { mounts[m[2]].push(resolved); grew = true; }
        }
      }
    }
    if (!grew) break;
  }
  // Per file: a top `router` may mount local sub-routers (const groups = express.Router();
  // router.use('/groups', groups)). Resolve var→mounts by fixpoint, then collect
  // <var>.method('path') calls per var.
  const ROUTER_VAR_RE = /const\s+(\w+)\s*=\s*express\.Router\(\)/g;
  const SUB_MOUNT_RE = /(\w+)\.use\('([^']+)',\s*(\w+)\)/g;
  const METHOD_RE = /(\w+)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  const endpoints = new Set();
  // Loop-registered routes (handler arrays) can't be seen by the static scan.
  // Keep this list auditable — each entry verified against the route source.
  const SUPPLEMENT = new Set(['POST /meals/analyze', 'POST /meals/detect']); // meals.js:10
  for (const e of SUPPLEMENT) endpoints.add(e);
  const unmounted = [];
  for (const file of files.sort()) {
    const base = mounts[file.replace(/\.js$/, '')];
    const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
    if (!base) { unmounted.push(file); continue; }
    const routerVars = new Set(['router', ...[...src.matchAll(ROUTER_VAR_RE)].map(m => m[1])]);
    const varMounts = { router: base };
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (const m of src.matchAll(SUB_MOUNT_RE)) {
        const [, parent, sub, child] = m;
        if (!routerVars.has(child) || !varMounts[parent]) continue;
        for (const b of varMounts[parent]) {
          const resolved = join(b, sub);
          (varMounts[child] ||= []).includes(resolved) || (varMounts[child].push(resolved), grew = true);
        }
      }
      if (!grew) break;
    }
    for (const m of src.matchAll(METHOD_RE)) {
      const [, varName, method, routePath] = m;
      for (const b of varMounts[varName] || []) endpoints.add(`${method.toUpperCase()} ${join(b, routePath)}`);
    }
  }
  return {
    apiContract: Number(versionSrc.match(/API_CONTRACT_VERSION\s*=\s*(\d+)/)[1]),
    minClientContract: Number(versionSrc.match(/MIN_CLIENT_CONTRACT\s*=\s*(\d+)/)[1]),
    endpoints: [...endpoints].sort(),
    unmountedFiles: unmounted,
  };
}

if (require.main === module) {
  const data = collect();
  const payload = JSON.stringify({
    generatedBy: 'scripts/emit-api-contract.js',
    apiContract: data.apiContract,
    minClientContract: data.minClientContract,
    endpointCount: data.endpoints.length,
    endpoints: data.endpoints,
    unmountedFiles: data.unmountedFiles,
  }, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    const strip = s => s.replace(/"generatedAt"[^,]*/, '');
    if (strip(committed) === strip(payload)) { console.log('api-contract.json is in sync'); process.exit(0); }
    console.error('api-contract.json DRIFTED — run: npm run contract:emit');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, payload);
  console.log(`Wrote ${OUT} — ${data.endpoints.length} endpoints, contract v${data.apiContract}/min ${data.minClientContract}${data.unmountedFiles.length ? `, unmounted: ${data.unmountedFiles.join(',')}` : ''}`);
}
module.exports = { collect, join };
