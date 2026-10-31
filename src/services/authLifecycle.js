const { randomBytes, createHmac } = require('node:crypto');
const { getPrisma } = require('../lib/prisma');
const { hashToken, hashPassword } = require('./authService');
const { httpError } = require('../lib/errors');
const GENERIC_MESSAGE = 'If this account is eligible, an email will arrive shortly. Check spam, or try again in a few minutes.';
function validateConfig() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.AUTH_LINK_SECRET || '')) throw new Error('AUTH_LINK_SECRET must be a random 32-byte hex secret.');
  const url = new URL(process.env.AUTH_PUBLIC_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('AUTH_PUBLIC_URL must be an HTTPS origin (localhost HTTP allowed outside production).');
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) throw new Error('RESEND_API_KEY and AUTH_EMAIL_FROM are required.');
}
function actionToken(id) {
  return createHmac('sha256', Buffer.from(process.env.AUTH_LINK_SECRET, 'hex')).update(`auth-action:${id}`).digest('base64url');
}
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Valid email required.');
  return email;
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw httpError(400, 'Password must contain 12–128 characters.');
}
async function enqueueAction(tx, user, purpose) {
  const id = randomBytes(32).toString('hex');
  return tx.authAction.create({ data: { id, tokenHash: hashToken(actionToken(id)), userId: user.id, email: user.email, purpose,
    expiresAt: new Date(Date.now() + (purpose === 'reset-password' ? 30 * 60000 : 24 * 3600000)) } });
}
// Atomic database buckets apply across processes and survive restarts. Keys contain no raw email/IP.
async function consumeLimit(scope, value, limit, windowMs) {
  const key = hashToken(`${scope}:${value}`);
  const now = new Date(), expiresAt = new Date(now.getTime() + windowMs);
  const rows = await getPrisma().$queryRaw`
    INSERT INTO "AuthRateBucket" ("key", "count", "expiresAt") VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateBucket"."expiresAt" <= ${now} THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
      "expiresAt" = CASE WHEN "AuthRateBucket"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "AuthRateBucket"."expiresAt" END
    WHERE "AuthRateBucket"."expiresAt" <= ${now} OR "AuthRateBucket"."count" < ${limit}
    RETURNING "count"`;
  return rows.length > 0;
}
async function requestAction(email, purpose) {
  // Suppress account throttling behind the same response for every address.
  if (!await consumeLimit(`email:${purpose}`, email, 3, 15 * 60000)) return;
  await getPrisma().$transaction(async tx => {
    const users = await tx.$queryRaw`SELECT * FROM "User" WHERE "email" = ${email} FOR UPDATE`;
    const user = users[0];
    if (!user?.passwordHash || (purpose === 'verify-email' && user.emailVerifiedAt)) return;
    await enqueueAction(tx, user, purpose);
  });
}
async function completeAction(token, purpose, password) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw httpError(400, 'This link is invalid or expired. Request a new email.');
  if (purpose === 'reset-password') validatePassword(password);
  const prisma = getPrisma();
  const tokenHash = hashToken(token);
  const action = await prisma.authAction.findUnique({ where: { tokenHash } });
  const invalid = () => httpError(400, 'This link is invalid or expired. Request a new email.');
  if (!action || action.purpose !== purpose || action.consumedAt || action.expiresAt <= new Date()) throw invalid();
  const passwordHash = purpose === 'reset-password' ? await hashPassword(password) : undefined;
  await prisma.$transaction(async tx => {
    const users = await tx.$queryRaw`SELECT * FROM "User" WHERE "id" = ${action.userId} FOR UPDATE`;
    if (!users[0] || users[0].email !== action.email) throw invalid();
    const used = await tx.authAction.updateMany({ where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (used.count !== 1) throw invalid();
    await tx.user.update({ where: { id: action.userId }, data: purpose === 'reset-password' ? { passwordHash } : { emailVerifiedAt: new Date() } });
    // Invalidate sibling links too, including any pending verification after a reset.
    await tx.authAction.updateMany({ where: { userId: action.userId, ...(purpose === 'verify-email' ? { purpose } : {}), consumedAt: null }, data: { consumedAt: new Date() } });
    if (purpose === 'reset-password') await tx.authSession.deleteMany({ where: { userId: action.userId } });
  });
}
// Lets the hosted action page render the correct state before submission. Never consumes the token.
async function actionStatus(token, purpose) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(typeof token === 'string' ? token : '') || !['verify-email', 'reset-password'].includes(purpose)) return 'invalid';
  const action = await getPrisma().authAction.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!action || action.purpose !== purpose) return 'invalid';
  if (action.consumedAt) return 'consumed';
  if (action.expiresAt <= new Date()) return 'expired';
  return 'ready';
}

module.exports = { GENERIC_MESSAGE, validateConfig, actionToken, normalizeEmail, validatePassword, enqueueAction, consumeLimit, requestAction, completeAction, actionStatus };
