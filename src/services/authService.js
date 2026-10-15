const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const scrypt = promisify(scryptCallback);
const hashToken = token => createHash('sha256').update(token).digest('hex');
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [salt, hex] = (encoded || '').split(':');
  const actual = await scrypt(password, salt || 'invalid-account', 64);
  const expected = Buffer.from(hex || '', 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function createSession(user, prisma = getPrisma()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await prisma.authSession.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt } });
  return { token, expiresAt, user: { id: user.id, email: user.email, emailVerifiedAt: user.emailVerifiedAt || null } };
}
async function authenticate(token) {
  if (!token || token.length > 200) throw httpError(401, 'Sign in required.');
  const session = await getPrisma().authSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.expiresAt <= new Date()) throw httpError(401, 'Session expired. Sign in again.');
  return session.userId;
}
module.exports = { hashPassword, verifyPassword, createSession, authenticate, hashToken };
