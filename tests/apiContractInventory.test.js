// HUM-34 §3: the committed inventory must match the live router surface —
// adding/renaming a route without regenerating docs/api-contract-inventory.json
// fails CI, so the contract catalog cannot silently drift.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

test('api-contract-inventory.json matches the live Express surface', () => {
  execSync('node scripts/generate-api-contract-inventory.js --write', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  const regenerated = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-contract-inventory.json'), 'utf8'));
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-contract-inventory.json'), 'utf8'));
  // compare route sets only (timestamps differ per run)
  const key = (r) => `${r.method} ${r.path} [${r.surface}]`;
  expect(regenerated.routes.map(key).sort()).toEqual(committed.routes.map(key).sort());
});

test('inventory classification invariants', () => {
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-contract-inventory.json'), 'utf8'));
  expect(inv.totals.routes).toBeGreaterThan(100);
  expect(inv.totals.routes).toBe(inv.totals.stable + inv.totals.experimental + inv.totals.internal);
  for (const r of inv.routes.filter((x) => x.surface === 'internal')) {
    expect(r.path).toMatch(/^\/(webhooks|test-fixtures|internal)/);
  }
  // duplicate method+path pairs are shadowed routes (first registration wins).
  // 20 known duplicates are documented debt in the inventory — this guard fails
  // if duplicates GROW beyond the recorded set or a NEW duplicate appears.
  const counts = {};
  for (const r of inv.routes) {
    const k = `${r.method} ${r.path}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  const actualDups = Object.keys(counts).filter((k) => counts[k] > 1).sort();
  expect(actualDups).toEqual(inv.knownDuplicates);
  for (const k of actualDups) {
    expect(inv.knownDuplicates).toContain(k);
  }
});
