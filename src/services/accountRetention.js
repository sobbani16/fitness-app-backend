const { getPrisma } = require('../lib/prisma');
// Backup/provider retention is enforced by hosting; this job enforces live-DB TTLs.
async function pruneRetainedRecords(now = new Date()) {
  const prisma = getPrisma();
  const day = 86400000;
  return prisma.$transaction(async tx => {
    await tx.legacyMigrationGrant.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * day) } } });
    const auditCutoff = new Date(now.getTime() - 30 * day);
    // Preserve only a non-personal bootstrap-completed marker so TTL cleanup cannot reopen bootstrap.
    await tx.auditLog.updateMany({ where: { action: 'admin.bootstrap', createdAt: { lt: auditCutoff }, actorId: { not: 'system:bootstrap-completed' } },
      data: { actorId: 'system:bootstrap-completed', entityId: null, beforeData: {}, afterData: {} } });
    await tx.auditLog.deleteMany({ where: { action: { not: 'admin.bootstrap' }, createdAt: { lt: auditCutoff } } });
    const receipts = await tx.accountDeletionReceipt.deleteMany({ where: { expiresAt: { lt: now } } });
    const sessions = await tx.authSession.deleteMany({ where: { expiresAt: { lt: now } } });
    const actions = await tx.authAction.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * day) } } });
    const buckets = await tx.authRateBucket.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } });
    return { receipts: receipts.count, sessions: sessions.count, actions: actions.count, buckets: buckets.count };
  });
}
module.exports = { pruneRetainedRecords };
