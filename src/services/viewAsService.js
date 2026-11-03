// View-as (preview/impersonation) tokens for SUPER_ADMIN support tooling.
// A signed, short-lived capability: lets a super admin read the API as a
// chosen user or with a chosen role's grants. Read-only — middleware rejects
// mutations while a view-as token is active.
const crypto = require('crypto');
const { getPrisma } = require('../lib/prisma');

const SECRET = process.env.VIEW_AS_SECRET || process.env.AUTH_LINK_SECRET || 'dev-view-as-secret';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function issueViewAsToken({ adminId, userId, role }) {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ v: 1, aid: adminId, uid: userId || null, role: role || null, exp })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(exp).toISOString() };
}

function verifyViewAsToken(token) {
  const err = Object.assign(new Error('View-as token invalid or expired.'), { status: 403 });
  const [payload, sig] = (token || '').split('.');
  if (!payload || !sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) throw err;
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw err; }
  if (!claims || claims.v !== 1 || !claims.aid || claims.exp < Date.now()) throw err;
  return claims;
}

async function isSuperAdmin(userId) {
  const row = await getPrisma().userRole.findFirst({
    where: { userId, active: true, role: { name: 'SUPER_ADMIN' } },
    select: { id: true },
  });
  return Boolean(row);
}

module.exports = { issueViewAsToken, verifyViewAsToken, isSuperAdmin };
