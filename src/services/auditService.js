const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
// Only operational metadata belongs in snapshots, never free-text health data or credentials.
const FIELDS = new Set(['userId', 'clientId', 'trainerId', 'nutritionistId', 'roleName', 'active', 'verified', 'status', 'tier', 'revokedSessions', 'sessionsRevoked', 'reference', 'reviewed', 'existed', 'previewState', 'visibility']);
function snapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => FIELDS.has(key) &&
    (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 128))));
}
async function log({ actorId, action, entityType, entityId, beforeData, afterData }, tx = getPrisma()) {
  return tx.auditLog.create({ data: { actorId, action, entityType, entityId: entityId || null,
    beforeData: snapshot(beforeData), afterData: snapshot(afterData) } });
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw httpError(400, 'Invalid audit pagination.');
  return Number(value);
}
async function query(options = {}) {
  const limit = integer(options.limit, 50, 1, 100);
  const offset = integer(options.offset, 0, 0, 10000);
  const where = {};
  for (const field of ['actorId', 'entityType', 'entityId', 'action']) {
    if (options[field] !== undefined) {
      if (typeof options[field] !== 'string' || !options[field].trim() || options[field].length > 128) throw httpError(400, 'Invalid audit filter.');
      where[field] = options[field];
    }
  }
  for (const [key, comparison] of [['from', 'gte'], ['to', 'lte']]) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(options[key]) || !Number.isFinite(Date.parse(options[key]))) throw httpError(400, 'Audit dates must be ISO timestamps.');
      where.createdAt = { ...where.createdAt, [comparison]: new Date(options[key]) };
    }
  }
  if (where.createdAt?.gte > where.createdAt?.lte) throw httpError(400, 'Audit date range is reversed.');
  const rows = await getPrisma().auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: offset });
  // Protect historical snapshots too; older records may contain free-text plans/reasons.
  return rows.map(row => ({ ...row, beforeData: snapshot(row.beforeData), afterData: snapshot(row.afterData) }));
}
module.exports = { log, query, snapshot };
