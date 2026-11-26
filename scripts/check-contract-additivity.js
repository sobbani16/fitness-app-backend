#!/usr/bin/env node
// Contract additivity guard (HUM-P6-013 backcompat). Compares the working-tree
// manifest against a base revision's: endpoints may be ADDED but never REMOVED,
// and apiContract/minClientContract versions must move monotonically forward.
// Rationale: old-mobile ↔ new-backend compatibility in both directions is only
// guaranteed while the surface grows additively; removals are breaking changes
// requiring a contract-version bump AND a release-order dependency note.
//
// Usage: node scripts/check-contract-additivity.js [--base origin/main]
// Exit 1 on any breaking change. Read-only.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function loadAt(rev) {
  try {
    return JSON.parse(execSync(`git show ${rev}:contracts/api-contract.json`, { cwd: ROOT, encoding: 'utf8' }));
  } catch { return null; }
}

function checkAdditivity(base = 'origin/main') {
  const problems = [];
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/api-contract.json'), 'utf8'));
  const prior = loadAt(base);
  if (!prior) return { ok: true, problems, note: `no manifest at ${base} — additive guard trivially passes (first introduction)` };
  const cur = new Set(current.endpoints), old = new Set(prior.endpoints);
  const removed = [...old].filter(e => !cur.has(e));
  const added = [...cur].filter(e => !old.has(e));
  for (const e of removed) problems.push(`BREAKING: endpoint removed vs ${base}: ${e} — requires contract-version bump + release-order note`);
  if (current.apiContract < prior.apiContract) problems.push(`BREAKING: apiContract version regressed ${prior.apiContract} → ${current.apiContract}`);
  if (current.minClientContract < prior.minClientContract) problems.push(`BREAKING: minClientContract regressed ${prior.minClientContract} → ${current.minClientContract}`);
  return { ok: problems.length === 0, problems, added: added.length, removed: removed.length };
}

if (require.main === module) {
  const baseIdx = process.argv.indexOf('--base');
  const base = baseIdx !== -1 ? process.argv[baseIdx + 1] : 'origin/main';
  const r = checkAdditivity(base);
  console.log(r.note || `vs ${base}: +${r.added} added, ${r.removed} removed`);
  for (const p of r.problems) console.log(`FAIL: ${p}`);
  if (r.ok && !r.note) console.log('contract evolution is additive — backcompat preserved');
  process.exit(r.ok ? 0 : 1);
}
module.exports = { checkAdditivity };
