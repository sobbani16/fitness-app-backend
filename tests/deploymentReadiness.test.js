const { assertDeploymentReady } = require('../src/services/deploymentReadiness');
const { ROLE_PERMISSIONS } = require('../src/config/rbac');
const manifest = [{ name: '001_required', checksum: 'expected' }];
function fixture() {
  return { $queryRaw: jest.fn().mockResolvedValue([{ migration_name: '001_required', checksum: 'expected', finished_at: new Date(), rolled_back_at: null }]),
    role: { findMany: jest.fn().mockResolvedValue(Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({ name, rolePermissions: permissions.map(name => ({ permission: { name } })) }))) } };
}
test('requires migrations and complete RBAC without writing data', async () => {
  expect(await assertDeploymentReady(fixture(), manifest)).toEqual({ migrations: 1, roles: Object.keys(ROLE_PERMISSIONS).length });
});
test.each([[], [{ migration_name: '001_required', checksum: 'wrong', finished_at: new Date() }], [{ migration_name: '001_required', checksum: 'expected', finished_at: null, rolled_back_at: new Date() }]].map(rows => [rows]))('rejects missing, changed and rolled-back migrations', async rows => {
  const db = fixture(); db.$queryRaw.mockResolvedValue(rows);
  await expect(assertDeploymentReady(db, manifest)).rejects.toThrow('Required migration');
});
test('unresolved failed migrations block even when expected migrations are applied', async () => {
  const db = fixture(); const rows = await db.$queryRaw(); db.$queryRaw.mockResolvedValue([...rows, { migration_name: 'future_failed' }]);
  await expect(assertDeploymentReady(db, manifest)).rejects.toThrow('Unresolved failed');
});
test('missing RBAC mapping blocks readiness', async () => {
  const db = fixture(); const roles = await db.role.findMany(); roles[0].rolePermissions = []; db.role.findMany.mockResolvedValue(roles);
  await expect(assertDeploymentReady(db, manifest)).rejects.toThrow('RBAC catalog incomplete');
});
test('connection failure does not expose connection credentials', async () => {
  const db = fixture(); db.$queryRaw.mockRejectedValue(new Error('postgresql://secret:password@host'));
  await expect(assertDeploymentReady(db, manifest)).rejects.toThrow('Migration history unavailable');
});
