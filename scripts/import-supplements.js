#!/usr/bin/env node
// Supplement research catalog import.
//
//   node scripts/import-supplements.js [--file path.json] [--apply] [--approved-hosted] [--audit-out path]
//
// Default is a DRY RUN: the full pipeline executes inside a transaction that
// is rolled back, so every write path is exercised without persisting anything.
// Pass --apply to commit. Hosted (non-localhost) writes additionally require
// --approved-hosted — production imports are an approval-gated action.

require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../src/lib/prisma');
const { importResearch, csvConsistency } = require('../src/services/supplements/researchImport');

const args = process.argv.slice(2);
const KNOWN = ['--apply', '--approved-hosted', '--file', '--audit-out'];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a.startsWith('--') && !KNOWN.includes(a) && !KNOWN.includes(args[i - 1])) throw new Error(`Unknown flag: ${a}`);
}
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

const apply = args.includes('--apply');
const file = argValue('--file') || path.join(__dirname, '..', 'data', 'imports', 'humai_supplement_research_seed_v1.json');
const auditOut = argValue('--audit-out')
  || path.join(__dirname, '..', 'data', 'imports', `supplement-import-audit-${new Date().toISOString().slice(0, 10)}${apply ? '' : '-dryrun'}.json`);

const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (apply && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !args.includes('--approved-hosted')) {
  throw new Error('Hosted writes require approval: re-run with --approved-hosted');
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const prisma = getPrisma();

(async () => {
  const audit = await importResearch(prisma, data, { apply });

  // Companion CSV cross-check (best-effort; JSON remains source of truth).
  try {
    const dir = path.dirname(file);
    const catalogCsv = fs.existsSync(path.join(dir, 'humai_supplement_catalog_207.csv'))
      ? fs.readFileSync(path.join(dir, 'humai_supplement_catalog_207.csv'), 'utf8') : null;
    const safetyCsv = fs.existsSync(path.join(dir, 'humai_supplement_safety_rules_47_draft.csv'))
      ? fs.readFileSync(path.join(dir, 'humai_supplement_safety_rules_47_draft.csv'), 'utf8') : null;
    audit.consistency = csvConsistency(data, catalogCsv, safetyCsv);
  } catch (err) {
    audit.consistency = { error: err.message };
  }

  fs.writeFileSync(auditOut, JSON.stringify(audit, null, 2));
  console.log(JSON.stringify({ ...audit.summary, audit: auditOut, dryRun: !apply }, null, 2));
  if (audit.validation.errors.length) {
    console.log('validation errors:', audit.validation.errors.slice(0, 20));
  }
  if (audit.results.supplements.errors.length) {
    console.log('item errors:', audit.results.supplements.errors.slice(0, 10));
  }
  process.exitCode = audit.validation.errors.length ? 1 : 0;
})()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
