#!/usr/bin/env node
// Fail-closed config guard: dev-secret literals must never serve as raw
// production fallbacks. Replaces the fragile workflow grep, which false-
// positive'd on its own enforcement definition — the PREDICTABLE denylist in
// src/lib/env.js literally lists the forbidden values (that is data, not
// usage), so a naive presence-match can never pass.
//
// Rules (no check weakened vs the original grep — only the false positive is
// removed):
//   1. A forbidden literal on a line containing `requiredSecret(` is the
//      approved dev-fallback pattern — pass.
//   2. A forbidden literal inside src/lib/env.js on a PURE array-entry line
//      (only quoted literals, commas, whitespace) is the denylist definition
//      itself — pass. Anything else in env.js still fails.
//   3. 'mock-secret' inside services/payments/provider.js is the documented
//      dev-only mock behind the isProduction() gate — pass (original rule).
//   4. Every other occurrence — assignment, fallback, object property, or
//      comment mention — fails closed.
//
// Usage: node scripts/check-dev-secret-guard.js [rootDir]   (exit 1 = violation)
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN = [
  'dev-view-as-secret', 'dev-video-secret', 'dev-doc-secret', 'dev-formcheck-secret',
  'mock-secret',
];
const ENV_DEF_FILE = path.normalize('src/lib/env.js');
const MOCK_ALLOWED_FILE = path.normalize('src/services/payments/provider.js');

// A pure array-entry line: whitespace, single/double-quoted literals, commas —
// nothing else. Such a line declares data; it cannot use a secret.
const PURE_ENTRY = /^\s*(['"][^'"]*['"],?\s*)+$/;

function scanFile(file, relFile) {
  const violations = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const hit = FORBIDDEN.find(lit => line.includes(`'${lit}'`) || line.includes(`"${lit}"`));
    if (!hit) return;
    if (line.includes('requiredSecret(')) return;                       // rule 1
    if (relFile === ENV_DEF_FILE && PURE_ENTRY.test(line)) return;      // rule 2
    if (hit === 'mock-secret' && relFile === MOCK_ALLOWED_FILE) return; // rule 3
    violations.push(`${relFile}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return violations;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function scan(rootDir) {
  const srcDir = path.join(rootDir, 'src');
  const violations = [];
  for (const file of walk(srcDir)) {
    violations.push(...scanFile(file, path.normalize(path.relative(rootDir, file))));
  }
  return violations;
}

if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const violations = scan(root);
  if (violations.length) {
    console.error(`dev-secret guard: ${violations.length} raw fallback occurrence(s) outside requiredSecret():`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('dev-secret guard: clean — no raw dev-secret fallbacks outside requiredSecret()');
}

module.exports = { scan, scanFile, PURE_ENTRY, FORBIDDEN };
