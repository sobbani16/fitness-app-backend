/**
 * Jest globalSetup — verify-or-provision the test database ONCE per run.
 *
 * Closes QA defect #330 durably: regression evidence can never again be
 * silently produced against a schema-less database. The heavy lifting lives
 * in scripts/provision-test-db.js (positive identification, advisory-lock
 * serialization, migrate deploy, schema verification); here we only decide
 * whether the run may proceed:
 *
 *   - No database URL configured      → pure-unit mode, nothing to check.
 *   - Database unreachable            → WARN but allow: pure-unit suites
 *                                       still pass offline; DB-backed suites
 *                                       fail on their own connection errors.
 *   - Reachable but unprovisionable   → THROW before any test executes.
 *                                       Running anyway is what produced the
 *                                       301-failure garbage evidence — the
 *                                       error names the remediation command.
 *   - Provisioned/current             → fast path, run proceeds.
 */
require('dotenv').config();
const { spawnSync } = require('child_process');
const path = require('path');
const { resolveTestDatabaseUrl, isPositiveTestDatabase } = require('./testDbUrl');

module.exports = async () => {
  const url = resolveTestDatabaseUrl();
  if (!url) return;
  const id = isPositiveTestDatabase(url);
  if (!id.ok) return; // setup.js owns the remote/unlabeled refusal policy per-suite
  const run = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 'provision-test-db.js'), url],
    { encoding: 'utf8', timeout: 360000 });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  if (run.status !== 0) {
    if (/P1001|ECONNREFUSED|Can't reach database server|Connection refused|ETIMEDOUT|Timed out/i.test(out)) {
      console.warn('[tests] WARNING: test database unreachable — DB-backed suites will fail on their own connection errors; pure-unit suites unaffected.');
      return;
    }
    throw new Error('[tests] test-database provisioning failed — refusing to produce evidence against a schema-less or drifted database.\n' +
      out.split('\n').filter(Boolean).slice(-8).join('\n') +
      '\nManual remediation: node scripts/provision-test-db.js');
    }
  const lines = out.trim().split('\n').filter(Boolean);
  console.log(`[tests] ${lines[lines.length - 1]}`);
};
