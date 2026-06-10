// Audit logging service.
// Tracks role changes, client assignments, plan CRUD, admin actions.

const { getPrisma } = require('../lib/prisma');

/**
 * Log an auditable action.
 * @param {{actorId: string, action: string, entityType: string, entityId?: string, beforeData?: object, afterData?: object}} entry
 */
async function log({ actorId, action, entityType, entityId, beforeData, afterData }) {
  const prisma = getPrisma();
  return prisma.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId: entityId || null,
      beforeData: beforeData || undefined,
      afterData: afterData || undefined,
    },
  });
}

/**
 * Query audit logs with filters.
 */
async function query({ actorId, entityType, limit = 50, offset = 0 } = {}) {
  const prisma = getPrisma();
  const where = {};
  if (actorId) where.actorId = actorId;
  if (entityType) where.entityType = entityType;
  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

module.exports = { log, query };
