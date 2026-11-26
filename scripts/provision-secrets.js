#!/usr/bin/env node
// Provision Humai signing/capability secrets.
//
// Generates cryptographically independent 32-byte hex secrets and writes them
// to a gitignored file (default: .env.generated). Values are NEVER printed to
// stdout — paste the file contents into your secret manager (Railway Variables,
// EAS Secrets, etc.) then delete the file.
//
// Usage:
//   node scripts/provision-secrets.js                 # writes .env.generated
//   node scripts/provision-secrets.js --out path.env  # custom output
//   node scripts/provision-secrets.js --check         # verify no file tracked
//
// Two modes:
//   - Independent secrets for every purpose (default; most explicit).
//   - A single HUMAI_SIGNING_MASTER the backend stretches via HMAC domain
//     separation into per-purpose keys (see lib/env.requiredSecret).

const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PURPOSES = [
  'AUTH_LINK_SECRET',
  'DOC_URL_SECRET',
  'VIDEO_TOKEN_SECRET',
  'FORM_CHECK_URL_SECRET',
  'VIEW_AS_SECRET',
  'PAYMENTS_WEBHOOK_SECRET',
];

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > -1 ? process.argv[outIdx + 1] : '.env.generated';

if (process.argv.includes('--check')) {
  const { execSync } = require('node:child_process');
  const tracked = execSync('git ls-files', { cwd: path.join(__dirname, '..') }).toString()
    .split('\n').filter((f) => f === outFile || /^\.env(\..+)?$/.test(f) && f !== '.env.example');
  if (tracked.length) { console.error(`TRACKED SECRET FILES: ${tracked.join(', ')}`); process.exit(1); }
  console.log('No environment files are tracked by git.');
  process.exit(0);
}

const lines = [
  '# Humai generated secrets — DO NOT COMMIT.',
  `# Generated ${new Date().toISOString()} — provision then delete this file.`,
  '',
];
for (const name of PURPOSES) lines.push(`${name}=${randomBytes(32).toString('hex')}`);
lines.push('', '# Alternative: one master secret, per-purpose derivation via HMAC.', '# HUMAI_SIGNING_MASTER=<64-hex>');

fs.writeFileSync(outFile, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote ${PURPOSES.length} secrets to ${outFile} (mode 0600).`);
console.log(`Purposes: ${PURPOSES.join(', ')}`);
console.log('Next: paste into your secret manager, then delete this file. Values are not echoed.');
