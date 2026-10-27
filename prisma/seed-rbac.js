// Seeds roles, permissions, and role-permission mappings.
// Run with: node prisma/seed-rbac.js

const { getPrisma } = require('../src/lib/prisma');

const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../src/config/rbac');

async function main() {
  await getPrisma().$transaction(async prisma => {

  // 1. Seed roles
  console.log('Seeding roles...');
  const roleMap = {};
  for (const r of ROLES) {
    const row = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r,
    });
    roleMap[r.name] = row.id;
  }
  console.log(`  ✓ ${ROLES.length} roles`);

  // 2. Seed permissions
  console.log('Seeding permissions...');
  const permMap = {};
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { name: p.name },
      update: { description: p.description },
      create: p,
    });
    permMap[p.name] = row.id;
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions`);

  // 3. Seed role-permission mappings
  console.log('Seeding role-permission mappings...');
  let count = 0;
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleMap[roleName];
    for (const permName of perms) {
      const permissionId = permMap[permName];
      if (!permissionId) throw new Error('Unknown permission in RBAC catalog.');
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
      count++;
    }
  }
  console.log(`  ✓ ${count} role-permission mappings`);

  }, { timeout: 60000 });
  console.log('\n✅ RBAC seeded successfully!');
}

main()
  .then(async () => { await getPrisma().$disconnect(); })
  .catch(async (err) => { console.error(err); await getPrisma().$disconnect(); process.exit(1); });
