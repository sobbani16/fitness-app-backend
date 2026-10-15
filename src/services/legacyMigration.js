const { randomBytes } = require('node:crypto');
const { getPrisma } = require('../lib/prisma');
const { hashToken, verifyPassword, createSession } = require('./authService');
const { consumeLimit } = require('./authLifecycle');
const { OWNED } = require('./accountData');
const { httpError } = require('../lib/errors');
const PROOFS = ['preexisting-verified-contact', 'independent-support-review'];
function eligible(user) {
  return user && /^dev-[a-z0-9]+-[a-z0-9]+$/.test(user.id) && user.email === `${user.id}@device.local` && !user.passwordHash && !user.emailVerifiedAt;
}
async function memberOnly(tx, id) {
  const roles = await tx.userRole.findMany({ where: { userId: id }, include: { role: true } });
  if (roles.some(row => row.role.name !== 'MEMBER') || await tx.trainerProfile.count({ where: { userId: id } }) || await tx.nutritionistProfile.count({ where: { userId: id } }) || await tx.creatorProfile.count({ where: { userId: id } })) throw httpError(409, 'This account requires a specialist migration review.');
}
// Operator-only service. No public/admin HTTP endpoint accepts self-asserted ownership evidence.
async function issueGrant({ legacyUserId, targetEmail, proofType, evidenceReference }) {
  if (!PROOFS.includes(proofType) || typeof evidenceReference !== 'string' || evidenceReference.trim().length < 8 || evidenceReference.length > 200) throw new Error('Independent proof type and a non-sensitive reviewed evidence reference are required.');
  const token = randomBytes(32).toString('base64url');
  await getPrisma().$transaction(async tx => {
    const legacy = await tx.user.findUnique({ where: { id: legacyUserId } });
    const target = await tx.user.findUnique({ where: { email: targetEmail.trim().toLowerCase() } });
    if (!eligible(legacy) || !target?.emailVerifiedAt || !target.passwordHash || target.id === legacy.id) throw new Error('Eligible legacy account and verified destination account required.');
    const ids = [legacy.id, target.id].sort();
    const locked = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
    if (locked.length !== 2) throw new Error('Account changed during review. Try again.');
    const freshLegacy = await tx.user.findUnique({ where: { id: legacy.id } });
    if (!eligible(freshLegacy)) throw new Error('Legacy account is no longer eligible.');
    await memberOnly(tx, legacy.id); await memberOnly(tx, target.id);
    await tx.legacyMigrationGrant.updateMany({ where: { legacyUserId, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.legacyMigrationGrant.create({ data: { legacyUserId, targetUserId: target.id, tokenHash: hashToken(token), proofType, evidenceReference: evidenceReference.trim(), expiresAt: new Date(Date.now() + 30 * 60000) } });
  });
  return token;
}
async function redeemGrant(userId, sessionToken, { token, password } = {}) {
  if (!await consumeLimit('legacy-migration', userId, 5, 15 * 60000)) throw httpError(429, 'Too many migration attempts. Try again in 15 minutes.');
  const invalid = () => httpError(400, 'Migration code is invalid, expired, or belongs to another account.');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== 'string' || password.length > 128) throw invalid();
  return getPrisma().$transaction(async tx => {
    const grant = await tx.legacyMigrationGrant.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!grant || grant.targetUserId !== userId || grant.consumedAt || grant.expiresAt <= new Date()) throw invalid();
    const ids = [userId, grant.legacyUserId].sort();
    const users = await tx.$queryRaw`SELECT * FROM "User" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
    const target = users.find(u => u.id === userId), legacy = users.find(u => u.id === grant.legacyUserId);
    const session = await tx.authSession.findUnique({ where: { tokenHash: hashToken(sessionToken || '') } });
    if (!session || session.userId !== userId || session.expiresAt <= new Date()) throw httpError(401, 'Sign in again.');
    if (!eligible(legacy) || !target?.emailVerifiedAt || !await verifyPassword(password, target.passwordHash)) throw httpError(403, 'Verified account and current password required.');
    await memberOnly(tx, legacy.id); await memberOnly(tx, userId);
    if (target.profileData || target.firstName || target.lastName || target.dateOfBirth || target.gender || target.heightCm || target.currentWeightKg || target.goalType || target.activityLevel) throw httpError(409, 'Destination account already has data. Contact support; nothing was moved.');
    for (const model of OWNED.filter(m => m !== 'userRole')) if (await tx[model].count({ where: { userId } })) throw httpError(409, 'Destination account already has data. Contact support; nothing was moved.');
    for (const model of ['trainerClient','nutritionistClient','trainerDropForm','workoutPlan','mealPlan','coachNote']) if (await tx[model].count({ where: { clientId: userId } })) throw httpError(409, 'Destination account already has data. Contact support; nothing was moved.');
    if (await tx.recipe.count({ where: { creatorId: userId } }) || await tx.coachNote.count({ where: { coachId: userId } }) || await tx.auditLog.count({ where: { actorId: userId } })) throw httpError(409, 'Destination account already has data. Contact support; nothing was moved.');
    const consumed = await tx.legacyMigrationGrant.updateMany({ where: { id: grant.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw invalid();
    const role = await tx.role.findUnique({ where: { name: 'MEMBER' } });
    if (!role) throw httpError(503, 'Account setup unavailable.');
    await tx.authSession.deleteMany({ where: { userId: { in: ids } } });
    await tx.authAction.deleteMany({ where: { userId: { in: ids } } });
    await tx.userRole.deleteMany({ where: { userId: { in: ids } } });
    // Upgrade in place: all legacy IDs, child references and health records remain intact.
    await tx.user.delete({ where: { id: userId } });
    const upgraded = await tx.user.update({ where: { id: legacy.id }, data: { email: target.email, passwordHash: target.passwordHash, emailVerifiedAt: target.emailVerifiedAt } });
    await tx.userRole.create({ data: { userId: legacy.id, roleId: role.id } });
    await tx.legacyMigrationGrant.updateMany({ where: { OR: [{ legacyUserId: legacy.id }, { targetUserId: userId }], consumedAt: null }, data: { consumedAt: new Date() } });
    return { ...await createSession(upgraded, tx), migration: { previousAccountId: userId, legacyAccountId: legacy.id } };
  }, { timeout: 30000 });
}
module.exports = { eligible, issueGrant, redeemGrant, PROOFS };
