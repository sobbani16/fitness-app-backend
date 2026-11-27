const { getPrisma } = require('../src/lib/prisma');
const { assertDeploymentReady } = require('../src/services/deploymentReadiness');
const { validateConfig } = require('../src/lib/env');
const { validateConfig: validateAuthConfig } = require('../src/services/authLifecycle');
(async () => {
  try {
    // SEC-P07: env/secret validation runs first — a missing secret (e.g.
    // DATABASE_URL) is itself a deploy blocker, and must be reported before
    // the DB check fails on it opaquely. Production fails the gate; lower
    // environments warn so CI stays green.
    const { missing, warnings } = validateConfig();
    for (const w of warnings) console.warn(`config warning: ${w}`);
    if (missing.length) {
      const msg = `config secrets missing or predictable: ${missing.join(', ')}`;
      if (process.env.NODE_ENV === 'production') { console.error(msg); process.exitCode = 1; }
      else console.warn(`${msg} (non-production — warning only)`);
    }
    if (process.env.NODE_ENV === 'production') {
      try { validateAuthConfig(); }
      catch (e) { console.error(`auth config invalid: ${e.message}`); process.exitCode = 1; }
    }
    if (process.exitCode) return; // env gate already failed; DB checks are moot
    const result = await assertDeploymentReady(getPrisma());
    console.log(`Deployment ready: ${result.migrations} migrations and ${result.roles} required roles verified.`);
  } catch (error) {
    // Database errors may contain connection details; print only our controlled readiness failures.
    const known = /^(Migration history unavailable|Unresolved failed migration|Required migration missing or changed|Required RBAC catalog incomplete|Release migration files are missing)/.test(error.message);
    console.error(known ? error.message : 'Deployment readiness check failed. Inspect the database securely.');
    process.exitCode = 1;
  } finally { await getPrisma().$disconnect(); }
})();
