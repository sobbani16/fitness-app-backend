// Provider-neutral external-identity boundary (OIDC readiness).
// Internal User.id remains the ONLY join key for all health data. This module
// is the single place that may translate (iss, sub) -> userId. It performs no
// login/session issuance itself — token validation + provisioning arrive with
// the real provider integration (see docs/OIDC_INTEGRATION.md).
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

const MAX_IDENTITIES_PER_USER = 5;
const SUBJECT_MAX = 255;

// iss must be an https URL; comparison key drops scheme case + trailing slash.
function normalizeIssuer(iss) {
  if (typeof iss !== 'string' || !iss.trim()) throw httpError(400, 'issuer is required.');
  let url;
  try { url = new URL(iss.trim()); } catch { throw httpError(400, 'issuer must be a valid URL.'); }
  if (url.protocol !== 'https:' && process.env.NODE_ENV !== 'test') throw httpError(400, 'issuer must use https.');
  url.hash = ''; url.search = '';
  return url.toString().replace(/\/$/, '').toLowerCase();
}

function normalizeSubject(sub) {
  if (typeof sub !== 'string' || !sub.trim() || sub.length > SUBJECT_MAX) throw httpError(400, 'subject is required (opaque id, max 255 chars).');
  return sub.trim();
}

// Safe linking: must be called for an already-authenticated internal user.
// Idempotent for the same user; refuses to re-bind to another user (takeover).
async function linkIdentity(userId, { issuer, subject, provider = 'oidc' }, prisma = getPrisma()) {
  const iss = normalizeIssuer(issuer);
  const sub = normalizeSubject(subject);
  const existing = await prisma.userIdentity.findUnique({ where: { issuer_subject: { issuer: iss, subject: sub } } });
  if (existing) {
    if (existing.userId === userId) return { identity: existing, linked: false };
    throw httpError(409, 'This external identity is already linked to a different account.');
  }
  const count = await prisma.userIdentity.count({ where: { userId } });
  if (count >= MAX_IDENTITIES_PER_USER) throw httpError(409, `A maximum of ${MAX_IDENTITIES_PER_USER} linked identities is allowed.`);
  const identity = await prisma.userIdentity.create({ data: { userId, issuer: iss, subject: sub, provider: String(provider).slice(0, 50) } });
  return { identity, linked: true };
}

// Lookup for the future OIDC login path — returns userId or null. NOT mounted.
async function resolveUserByIdentity(issuer, subject, prisma = getPrisma()) {
  const iss = normalizeIssuer(issuer);
  const row = await prisma.userIdentity.findUnique({ where: { issuer_subject: { issuer: iss, subject } } });
  if (row) await prisma.userIdentity.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return row?.userId || null;
}

async function listIdentities(userId, prisma = getPrisma()) {
  return prisma.userIdentity.findMany({ where: { userId }, select: { id: true, provider: true, issuer: true, subject: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'asc' } });
}

// Unlink with lockout guard: never orphan an account that has no password.
async function unlinkIdentity(userId, identityId, prisma = getPrisma()) {
  const row = await prisma.userIdentity.findUnique({ where: { id: identityId } });
  if (!row || row.userId !== userId) throw httpError(404, 'Linked identity not found.');
  const [user, remaining] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    prisma.userIdentity.count({ where: { userId } }),
  ]);
  if (!user?.passwordHash && remaining <= 1) {
    throw httpError(409, 'Cannot remove the only sign-in method. Set a password first.');
  }
  await prisma.userIdentity.delete({ where: { id: identityId } });
  return { removed: true };
}

module.exports = { linkIdentity, resolveUserByIdentity, listIdentities, unlinkIdentity, normalizeIssuer };
