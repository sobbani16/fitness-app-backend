// Controlled Super Admin bootstrap — the ONLY way to grant SUPER_ADMIN.
// Run manually on a trusted operator's machine with DB access:
//   node scripts/grant-super-admin.js <user-email> --confirm
// Grants the SUPER_ADMIN role; revoking is the same script with --revoke.
// There is no web API for this — prevents privilege escalation via HTTP.
const { getPrisma } = require('../src/lib/prisma');

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email || (flag !== '--confirm' && flag !== '--revoke')) {
    console.error('Usage: node scripts/grant-super-admin.js <email> --confirm|--revoke');
    process.exit(1);
  }
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) { console.error('No such user.'); process.exit(1); }
  const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!role) { console.error('Run prisma/seed-rbac.js first.'); process.exit(1); }
  if (flag === '--confirm') {
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: { active: true }, create: { userId: user.id, roleId: role.id } });
    console.log(`SUPER_ADMIN granted to ${email}`);
  } else {
    await prisma.userRole.updateMany({ where: { userId: user.id, roleId: role.id }, data: { active: false } });
    console.log(`SUPER_ADMIN revoked from ${email}`);
  }
  const audit = require('../src/services/auditService');
  await audit.log({ actorId: 'system:bootstrap', action: flag === '--confirm' ? 'super_admin.grant' : 'super_admin.revoke', entityType: 'User', entityId: user.id, afterData: { email } });
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
