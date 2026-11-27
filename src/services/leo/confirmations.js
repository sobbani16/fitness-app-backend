// Leo confirmation gateway — binds a granted confirmation to
// (user, session, exact tool + args, expiry). Single-use; replay rejected.
const crypto = require('node:crypto');
const { getPrisma } = require('../../lib/prisma');
const { httpError } = require('../../lib/errors');

// Canonical JSON — sorted keys — so hashing is stable across field order.
const canon = (v) => v == null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;

const argsHash = (toolName, args) =>
  crypto.createHash('sha256').update(`${toolName}|${canon(args)}`).digest('hex');

/** Issue a confirmation for exactly this tool call. ttlSec default 120. */
async function issue(userId, sessionId, toolName, args, ttlSec = 120, db = getPrisma()) {
  return db.leoConfirmation.create({ data: {
    userId, sessionId, toolName, argsHash: argsHash(toolName, args),
    expiresAt: new Date(Date.now() + Math.min(600, Math.max(5, ttlSec)) * 1000),
  } });
}

/**
 * Consume a confirmation — succeeds once. Wrong binding (user/session/tool/
 * args), expiry, or replay all reject; nothing is consumed on failure.
 */
async function consume(userId, sessionId, confirmationId, toolName, args, db = getPrisma()) {
  const row = await db.leoConfirmation.findUnique({ where: { id: String(confirmationId || '') } });
  if (!row || row.userId !== userId || row.sessionId !== sessionId) throw httpError(404, 'confirmation_not_found');
  if (row.consumedAt) throw httpError(409, 'confirmation_already_consumed');
  if (row.expiresAt < new Date()) throw httpError(410, 'confirmation_expired');
  if (row.toolName !== toolName || row.argsHash !== argsHash(toolName, args)) throw httpError(409, 'confirmation_binding_mismatch');
  const claim = await db.leoConfirmation.updateMany({
    where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() },
  });
  if (!claim.count) throw httpError(409, 'confirmation_already_consumed'); // lost a race
  return { consumed: true, confirmationId: row.id };
}

// Post-mutation invalidation: when a session closes or is purged, its pending
// confirmations must never execute — the user approved an action in the
// context of a session that no longer exists. Invalidation expires rows in
// place (audit trail preserved; consume() then correctly reports 410).
async function invalidateSession(sessionId, db = getPrisma()) {
  const r = await db.leoConfirmation.updateMany({
    where: { sessionId: String(sessionId || ''), consumedAt: null },
    data: { expiresAt: new Date(0) },
  }).catch(() => ({ count: 0 }));
  return { invalidated: r.count };
}

module.exports = { issue, consume, invalidateSession, argsHash, canon };
