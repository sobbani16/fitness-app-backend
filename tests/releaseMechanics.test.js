// Release mechanics guards (pc-HUM-63): migration validation, expected-head
// guard, contract additivity. Fixture-based — no live git or DB mutation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateMigrations } = require('../scripts/check-migrations');
const { checkReleaseHead } = require('../scripts/check-release-head');
const { checkAdditivity } = require('../scripts/check-contract-additivity');

function migFixture(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  for (const [name, sql] of Object.entries(spec)) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    if (sql !== null) fs.writeFileSync(path.join(dir, name, 'migration.sql'), sql);
  }
  return dir;
}

describe('check-migrations', () => {
  test('clean sequence passes', () => {
    const r = validateMigrations(migFixture({ '20260101000000_init': 'CREATE TABLE x;', '20260102000000_add': 'ALTER TABLE x;' }));
    expect(r.count).toBe(2);
    expect(r.problems.filter(p => !p.includes('DROP TABLE'))).toEqual([]);
  });
  test('duplicate timestamps flagged as serialized-merge violations', () => {
    const r = validateMigrations(migFixture({ '20260101000000_a': 'SELECT 1;', '20260101000000_b': 'SELECT 2;' }));
    expect(r.problems.some(p => p.includes('duplicate timestamp'))).toBe(true);
  });
  test('missing or empty migration.sql flagged', () => {
    const r = validateMigrations(migFixture({ '20260101000000_nofile': null, '20260102000000_empty': '   ' }));
    expect(r.problems.some(p => p.includes('migration.sql missing'))).toBe(true);
    expect(r.problems.some(p => p.includes('migration.sql empty'))).toBe(true);
  });
  test('malformed directory names flagged', () => {
    const r = validateMigrations(migFixture({ 'not-a-migration': 'SELECT 1;' }));
    expect(r.problems.some(p => p.includes('does not match'))).toBe(true);
  });
});

describe('check-release-head', () => {
  test('rejects non-SHA expect values', () => {
    const r = checkReleaseHead({ branch: 'HEAD', expect: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('40-char SHA');
  });
  test('rejects unresolvable branches', () => {
    const r = checkReleaseHead({ branch: 'definitely-not-a-branch-xyz', expect: '0'.repeat(40) });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('unresolvable');
  });
  test('detects head mismatch — tested revision is not what would merge', () => {
    const r = checkReleaseHead({ branch: 'HEAD', expect: '0'.repeat(40) });
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.includes('head mismatch'))).toBe(true);
  });
});

describe('check-contract-additivity', () => {
  test('passes trivially when base has no manifest (first introduction)', () => {
    const r = checkAdditivity('origin/main');
    expect(r.ok).toBe(true);
    expect(r.note).toContain('no manifest');
  });
});
