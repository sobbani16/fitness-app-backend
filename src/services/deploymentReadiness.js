const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ROLE_PERMISSIONS } = require('../config/rbac');
function migrationManifest(directory = path.join(__dirname, '../../prisma/migrations')) {
  const names = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (!names.length) throw new Error('Release migration files are missing.');
  return names.map(name => ({ name, checksum: createHash('sha256').update(fs.readFileSync(path.join(directory, name, 'migration.sql'))).digest('hex') }));
}
async function assertDeploymentReady(prisma, manifest = migrationManifest()) {
  let applied;
  try { applied = await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`; }
  catch { throw new Error('Migration history unavailable. Run the reviewed deployment preparation.'); }
  if (applied.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error('Unresolved failed migration. Stop and follow the migration recovery runbook.');
  for (const expected of manifest) {
    if (!applied.some(row => row.migration_name === expected.name && row.finished_at && !row.rolled_back_at && row.checksum === expected.checksum)) {
      throw new Error(`Required migration missing or changed: ${expected.name}`);
    }
  }
  const roles = await prisma.role.findMany({ include: { rolePermissions: { include: { permission: true } } } });
  for (const [name, required] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roles.find(row => row.name === name);
    const permissions = new Set(role?.rolePermissions.map(row => row.permission.name));
    if (!role || required.some(permission => !permissions.has(permission))) throw new Error(`Required RBAC catalog incomplete: ${name}`);
  }
  return { migrations: manifest.length, roles: Object.keys(ROLE_PERMISSIONS).length };
}
module.exports = { migrationManifest, assertDeploymentReady };
