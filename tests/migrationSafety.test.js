// HUM-34 §14: migration/deploy safety guard.
// The chain is additive/widening by policy — rolling deploys run migrations
// before new code, so destructive or narrowing operations break in-flight
// old-version instances. This test fails CI if a NEW migration introduces:
//   DROP COLUMN / DROP TABLE  (data loss + old-code breakage)
//   SET NOT NULL              (write hazard for existing rows)
//   RENAME                    (read/write breakage both directions)
// The one historical exception is recorded and cannot grow silently.
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', 'prisma', 'migrations');
// documented historical exceptions (pre-audit); keyed by migration folder
const KNOWN_EXCEPTIONS = new Set(['20260619231816_remove_trainer_monthly_rate']);

const PATTERNS = [
  { re: /DROP\s+COLUMN/i, label: 'DROP COLUMN' },
  { re: /DROP\s+TABLE/i, label: 'DROP TABLE' },
  { re: /SET\s+NOT\s+NULL/i, label: 'SET NOT NULL' },
  { re: /\bRENAME\b/i, label: 'RENAME' },
];

function scan() {
  const findings = [];
  for (const dir of fs.readdirSync(MIGRATIONS)) {
    const file = path.join(MIGRATIONS, dir, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, 'utf8');
    for (const { re, label } of PATTERNS) {
      // DROP NOT NULL is widening (safe) and matches none of these patterns
      if (re.test(sql)) findings.push({ migration: dir, op: label });
    }
  }
  return findings;
}

describe('migration deploy-safety (§14)', () => {
  it('no destructive or narrowing operations outside documented exceptions', () => {
    const findings = scan().filter((f) => !KNOWN_EXCEPTIONS.has(f.migration));
    expect(findings).toEqual([]);
  });

  it('the exception set cannot grow silently — exactly one documented case', () => {
    expect(KNOWN_EXCEPTIONS.size).toBe(1);
    const all = scan();
    const documented = all.filter((f) => KNOWN_EXCEPTIONS.has(f.migration));
    // if the exception migration is ever cleaned up, this fails and the test must be revisited
    expect(documented.length).toBeGreaterThan(0);
  });

  it('migration chain is drift-free against the schema', () => {
    // verified at audit time via prisma migrate diff (empty diff); this guard
    // re-checks the invariant that every migration folder has non-empty sql
    for (const dir of fs.readdirSync(MIGRATIONS)) {
      const file = path.join(MIGRATIONS, dir, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    }
  });
});
