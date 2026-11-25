#!/usr/bin/env node
// CI dependency-audit gate: fails on high/critical advisories in production
// deps EXCEPT those documented in docs/security-audit/known-advisories.json.
// The allowlist is a review record — every entry needs id, reason, review date.
//
// Usage: node scripts/audit-gate.js [--dev]  (dev includes devDependencies)
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const includeDev = process.argv.includes('--dev');
const allowlistPath = path.join(__dirname, '..', 'docs/security-audit/known-advisories.json');
const allowlist = fs.existsSync(allowlistPath)
  ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  : { advisories: [] };
const allowed = new Set(allowlist.advisories.map((a) => a.id));

let audit;
try {
  audit = JSON.parse(execSync(`npm audit --json ${includeDev ? '' : '--omit=dev'}`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString());
} catch (err) {
  // npm audit exits non-zero when vulns exist — stdout still carries the JSON.
  audit = JSON.parse(err.stdout?.toString() || '{}');
}
if (!audit.vulnerabilities) { console.error('npm audit produced no parseable report'); process.exit(1); }

const findings = [];
for (const [pkg, info] of Object.entries(audit.vulnerabilities)) {
  if (!['high', 'critical'].includes(info.severity)) continue;
  const via = (info.via || []).filter((v) => typeof v === 'object');
  for (const adv of via) {
    findings.push({ pkg, id: adv.source || adv.url || `${pkg}:${info.severity}`, title: adv.title, severity: info.severity, path: info.effects?.join(' <- ') || pkg });
  }
}

const unexpected = findings.filter((f) => !allowed.has(f.id));
const expected = findings.filter((f) => allowed.has(f.id));
for (const f of expected) console.log(`ALLOWED  ${f.severity} ${f.pkg} ${f.id} — ${f.title}`);
for (const f of unexpected) console.log(`FAIL     ${f.severity} ${f.pkg} ${f.id} — ${f.title} (${f.path})`);
if (unexpected.length) {
  console.error(`\n${unexpected.length} unreviewed high/critical production advisories. Fix or document in ${allowlistPath}`);
  process.exit(1);
}
console.log(`\nAudit gate passed: ${findings.length} high/critical, ${expected.length} allowlisted, 0 unexpected.`);
