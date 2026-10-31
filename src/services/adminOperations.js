const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const audit = require('./auditService');

async function authorize(tx, actorId, permission, superOnly = false) {
  const roles = await tx.userRole.findMany({ where: { userId: actorId, active: true }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
  if (!roles.some(r => r.role.rolePermissions.some(p => p.permission.name === permission)) ||
      (superOnly && !roles.some(r => r.role.name === 'SUPER_ADMIN'))) throw httpError(403, 'Insufficient administrator permissions.');
}
async function changeRole(actorId, { userId, roleName } = {}, active) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 128 || typeof roleName !== 'string' || !/^[A-Z_]{1,64}$/.test(roleName)) throw httpError(400, 'Valid userId and roleName required.');
  return getPrisma().$transaction(async tx => {
    // Same target-user then role-table lock order as the provisioning CLI.
    const users = await tx.$queryRaw`SELECT "id", "emailVerifiedAt" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (!users.length) throw httpError(404, 'Account not found.');
    if (active && !users[0].emailVerifiedAt) throw httpError(409, 'Account must verify its email first.');
    await tx.$executeRaw`LOCK TABLE "UserRole" IN SHARE ROW EXCLUSIVE MODE`;
    await authorize(tx, actorId, 'MANAGE_ROLES', roleName === 'SUPER_ADMIN');
    const role = await tx.role.findUnique({ where: { name: roleName } });
    if (!role) throw httpError(404, 'Role not found.');
    const where = { userId_roleId: { userId, roleId: role.id } };
    const previous = await tx.userRole.findUnique({ where });
    if (!active && previous?.active && roleName === 'SUPER_ADMIN' && await tx.userRole.count({ where: { roleId: role.id, active: true } }) <= 1) throw httpError(409, 'Provision another super administrator before removing the last one.');
    if (Boolean(previous?.active) === active) return previous ? { ...previous, roleName } : { ok: true };
    const result = await tx.userRole.upsert({ where, update: { active, assignedAt: new Date() }, create: { userId, roleId: role.id, active } });
    const sessions = await tx.authSession.deleteMany({ where: { userId } });
    await audit.log({ actorId, action: active ? 'role.assign' : 'role.remove', entityType: 'UserRole', entityId: result.id,
      beforeData: { active: Boolean(previous?.active) }, afterData: { userId, roleName, active, revokedSessions: sessions.count } }, tx);
    return { ...result, roleName };
  }, { timeout: 15000 });
}
async function verifyTrainer(actorId, id, verified) {
  if (typeof verified !== 'boolean') throw httpError(400, 'verified must be a boolean.');
  return getPrisma().$transaction(async tx => {
    let before = await tx.trainerProfile.findUnique({ where: { id } });
    if (!before) throw httpError(404, 'Trainer not found.');
    const users = await tx.$queryRaw`SELECT "id", "emailVerifiedAt" FROM "User" WHERE "id" = ${before.userId} FOR UPDATE`;
    if (!users.length || (verified && !users[0].emailVerifiedAt)) throw httpError(409, 'Trainer requires an existing verified account.');
    await tx.$executeRaw`LOCK TABLE "UserRole" IN SHARE ROW EXCLUSIVE MODE`;
    await authorize(tx, actorId, 'MANAGE_TRAINERS');
    before = await tx.trainerProfile.findUnique({ where: { id } });
    if (!before) throw httpError(404, 'Trainer not found.');
    const role = await tx.role.findUnique({ where: { name: 'TRAINER' } });
    if (!role) throw httpError(409, 'TRAINER role must be provisioned first.');
    const trainer = await tx.trainerProfile.update({ where: { id }, data: verified
      ? { verified: true, active: true, applicationStatus: 'approved', approvedAt: new Date(), approvedBy: actorId }
      : { verified: false, active: false, applicationStatus: 'rejected' } });
    await tx.userRole.upsert({ where: { userId_roleId: { userId: trainer.userId, roleId: role.id } }, update: { active: verified }, create: { userId: trainer.userId, roleId: role.id, active: verified } });
    await tx.authSession.deleteMany({ where: { userId: trainer.userId } });
    await audit.log({ actorId, action: 'trainer.verify', entityType: 'TrainerProfile', entityId: id,
      beforeData: { verified: before.verified, active: before.active }, afterData: { userId: trainer.userId, verified, active: verified } }, tx);
    return trainer;
  }, { timeout: 15000 });
}
const REVIEW_DECISIONS = ['approve', 'reject', 'request_changes'];
async function reviewTrainer(actorId, id, { decision, note } = {}) {
  if (!REVIEW_DECISIONS.includes(decision)) throw httpError(400, 'decision must be approve|reject|request_changes.');
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 2000)) throw httpError(400, 'note must be a string under 2000 chars.');
  return getPrisma().$transaction(async tx => {
    let before = await tx.trainerProfile.findUnique({ where: { id } });
    if (!before) throw httpError(404, 'Trainer not found.');
    const users = await tx.$queryRaw`SELECT "id", "emailVerifiedAt" FROM "User" WHERE "id" = ${before.userId} FOR UPDATE`;
    if (!users.length) throw httpError(404, 'Trainer account not found.');
    await tx.$executeRaw`LOCK TABLE "UserRole" IN SHARE ROW EXCLUSIVE MODE`;
    await authorize(tx, actorId, 'MANAGE_TRAINERS');
    before = await tx.trainerProfile.findUnique({ where: { id } });
    const role = await tx.role.findUnique({ where: { name: 'TRAINER' } });
    const now = new Date();
    let trainer;
    if (decision === 'approve') {
      // Same atomic path as verifyTrainer: verify + activate + TRAINER role +
      // session revoke, plus the application bookkeeping.
      if (!users[0].emailVerifiedAt) throw httpError(409, 'Trainer requires an existing verified account.');
      if (!role) throw httpError(409, 'TRAINER role must be provisioned first.');
      trainer = await tx.trainerProfile.update({ where: { id }, data: {
        verified: true, active: true, applicationStatus: 'approved',
        approvedAt: now, approvedBy: actorId, applicationNote: note || null,
      } });
      await tx.userRole.upsert({ where: { userId_roleId: { userId: trainer.userId, roleId: role.id } }, update: { active: true }, create: { userId: trainer.userId, roleId: role.id, active: true } });
    } else {
      // reject | request_changes — pull the profile out of the approved pool:
      // unverified + inactive (mirrors the un-verify path) so it cannot appear
      // in discovery or serve trainer data until re-approved.
      const applicationStatus = decision === 'reject' ? 'rejected' : 'changes_requested';
      trainer = await tx.trainerProfile.update({ where: { id }, data: {
        verified: false, active: false, applicationStatus,
        applicationNote: note || null, approvedAt: null, approvedBy: null,
      } });
      if (role) await tx.userRole.updateMany({ where: { userId: trainer.userId, roleId: role.id }, data: { active: false } });
    }
    await tx.authSession.deleteMany({ where: { userId: trainer.userId } });
    await audit.log({ actorId, action: `trainer.review.${decision}`, entityType: 'TrainerProfile', entityId: id,
      beforeData: { applicationStatus: before.applicationStatus, verified: before.verified, active: before.active },
      afterData: { userId: trainer.userId, applicationStatus: trainer.applicationStatus, verified: trainer.verified, active: trainer.active, decision } }, tx);
    return trainer;
  }, { timeout: 15000 });
}
module.exports = { changeRole, verifyTrainer, reviewTrainer };
