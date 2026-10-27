const { getPrisma } = require('../src/lib/prisma');
const { assertDeploymentReady } = require('../src/services/deploymentReadiness');
(async () => {
  try {
    const result = await assertDeploymentReady(getPrisma());
    console.log(`Deployment ready: ${result.migrations} migrations and ${result.roles} required roles verified.`);
  } catch (error) {
    // Database errors may contain connection details; print only our controlled readiness failures.
    const known = /^(Migration history unavailable|Unresolved failed migration|Required migration missing or changed|Required RBAC catalog incomplete|Release migration files are missing)/.test(error.message);
    console.error(known ? error.message : 'Deployment readiness check failed. Inspect the database securely.');
    process.exitCode = 1;
  } finally { await getPrisma().$disconnect(); }
})();
