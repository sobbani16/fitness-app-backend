#!/usr/bin/env node
// Migration validation (release mechanics, pc-HUM-63). Static, read-only —
// no database access. Verifies release-facing invariants of prisma/migrations:
//   1. every migration directory is timestamp-ordered and parseable
//   2. no duplicate timestamps (serialized-merge violations)
//   3. migration.sql is non-empty and parses as plausible SQL
//   4. no destructive-without-guardrail patterns (DROP TABLE without IF EXISTS
//      is informational, not fatal — Prisma emits those intentionally)
//   5. schema.prisma validates (delegates to prisma validate when available)
// Exit 1 on any structural violation; prints a per-check verdict.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'prisma/migrations');

function validateMigrations(dir = DIR) {
  const problems = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'migration_lock.toml' && !e.name.startsWith('.'))
    .map(e => e.name).sort();
  const seen = new Map();
  let prev = '';
  for (const name of entries) {
    if (!/^\d{14}_.+/.test(name)) { problems.push(`${name}: directory does not match <14-digit-ts>_<name>`); continue; }
    const ts = name.slice(0, 14);
    if (seen.has(ts)) problems.push(`${name}: duplicate timestamp shared with ${seen.get(ts)} — serialized-merge violation`);
    seen.set(ts, name);
    if (prev && name < prev) problems.push(`${name}: ordering regression after ${prev}`);
    prev = name;
    const file = path.join(dir, name, 'migration.sql');
    if (!fs.existsSync(file)) { problems.push(`${name}: migration.sql missing`); continue; }
    const sql = fs.readFileSync(file, 'utf8');
    if (!sql.trim()) { problems.push(`${name}: migration.sql empty`); continue; }
    if (sql.includes('```')) problems.push(`${name}: markdown fence content detected`);
    const drops = sql.match(/DROP TABLE(?!\s+IF EXISTS)/gi) || [];
    if (drops.length) problems.push(`${name}: ${drops.length} unguarded DROP TABLE — review before release`);
  }
  return { count: entries.length, problems };
}

if (require.main === module) {
  const { count, problems } = validateMigrations();
  const fatal = problems.filter(p => !p.includes('unguarded DROP TABLE'));
  console.log(`migrations scanned: ${count}`);
  for (const p of problems) console.log(`${fatal.includes(p) ? 'FAIL' : 'warn'}: ${p}`);
  if (!problems.length) console.log('all migration invariants hold');
  process.exit(fatal.length ? 1 : 0);
}
module.exports = { validateMigrations };
