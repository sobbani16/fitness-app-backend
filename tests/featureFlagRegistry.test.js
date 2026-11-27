// Guards the flag-key drift class: every requireFeature('literal') in route
// code must resolve to a registered FEATURES key. A typo'd or renamed key
// silently disables the route (gate evaluates false) with no other signal.
const fs = require('node:fs');
const path = require('node:path');
const { FEATURES } = require('../src/config/featureRegistry');

const SRC = path.resolve(__dirname, '../src');
const LITERAL = /requireFeature\(\s*'([^']+)'/g;

function* jsFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsFiles(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

describe('feature-flag registry integrity', () => {
  test('every requireFeature literal resolves to a registered flag', () => {
    const keys = new Set(Object.keys(FEATURES));
    const unknown = [];
    let count = 0;
    for (const f of jsFiles(SRC)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(LITERAL)) {
        count += 1;
        if (!keys.has(m[1])) unknown.push(`${path.relative(SRC, f)}: '${m[1]}'`);
      }
    }
    expect(count).toBeGreaterThan(20); // sanity — scan actually ran
    expect(unknown).toEqual([]);
  });

  test('dependsOn references resolve within the registry', () => {
    const keys = new Set(Object.keys(FEATURES));
    const dangling = Object.entries(FEATURES)
      .flatMap(([k, v]) => (v.dependsOn || []).map(d => ({ k, d })))
      .filter(({ d }) => !keys.has(d))
      .map(({ k, d }) => `${k} dependsOn '${d}'`);
    expect(dangling).toEqual([]);
  });
});
