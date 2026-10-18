// Operator CLI only. Never mount this service as a public registration/recovery endpoint.
const { createHash } = require('node:crypto');
class ProvisioningError extends Error {}
const fail = message => { throw new ProvisioningError(message); };
function validate(options) {
  if (!['bootstrap', 'recover'].includes(options.mode)) fail('Choose bootstrap or recover mode.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.userId || '')) fail('A registered account UUID is required.');
  for (const field of ['operator', 'reference']) if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/.test(options[field] || '')) fail('Operator and review reference must be opaque 3–80 character references, without email addresses or free text.');
  if (options.apply && (options.reviewed !== true || !/^[a-f0-9]{64}$/.test(options.expectedState || ''))) fail('Applying requires independent-review attestation and the exact preview state.');
}
function targetIdentity(databaseUrl) {
  let url;
  try { url = new URL(databaseUrl); } catch { fail('A PostgreSQL DATABASE_URL is required.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2 || url.searchParams.has('host')) fail('A PostgreSQL DATABASE_URL is required.');
  const schema = url.searchParams.get('schema') || 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) fail('Use an explicit simple PostgreSQL schema name.');
  return `${url.hostname}:${url.port || '5432'}${url.pathname}?schema=${schema}`;
}
async function provisionAdmin(db, options, databaseUrl = process.env.DATABASE_URL) {
  validate(options);
  const target = targetIdentity(databaseUrl);
  return db.$transaction(async tx => {
    // Same lock order as ordinary user-scoped mutations: user first, role inventory second.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${options.userId} FOR UPDATE`;
    // Serializes with ordinary role writes too, not only other CLI invocations.
    await tx.$executeRaw`LOCK TABLE "UserRole" IN SHARE ROW EXCLUSIVE MODE`;
    const user = await tx.user.findUnique({ where: { id: options.userId }, select: { id: true, passwordHash: true, emailVerifiedAt: true, updatedAt: true } });
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(user?.passwordHash || '') || !user.emailVerifiedAt) fail('Target must be an existing password-authenticated, email-verified account.');
    const role = await tx.role.findUnique({ where: { name: 'SUPER_ADMIN' }, include: { rolePermissions: { include: { permission: true } } } });
    const permissions = role?.rolePermissions.map(p => p.permission.name).sort() || [];
    if (!role || !['MANAGE_ROLES', 'MANAGE_USERS', 'VIEW_AUDIT_LOGS', 'MANAGE_SUPER_ADMINS'].every(p => permissions.includes(p))) fail('Seed and verify the complete SUPER_ADMIN RBAC configuration first.');
    const inventory = await tx.userRole.findMany({ where: { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { userId: true, roleId: true, active: true, assignedAt: true }, orderBy: [{ userId: 'asc' }, { roleId: 'asc' }] });
    const previous = await tx.auditLog.findFirst({ where: { action: 'admin.bootstrap' }, select: { id: true } });
    if (options.mode === 'bootstrap' && (inventory.length || previous)) fail('Administrator history already exists. Use the reviewed recovery process or an existing administrator.');
    const state = createHash('sha256').update(JSON.stringify({ target, mode: options.mode, operator: options.operator, reference: options.reference,
      user: { id: user.id, verifiedAt: user.emailVerifiedAt, updatedAt: user.updatedAt }, roleId: role.id, permissions, inventory, previous })).digest('hex');
    const plan = { target, mode: options.mode, userId: user.id, role: 'SUPER_ADMIN', privilegedAssignments: inventory.length, expectedState: state,
      effects: ['Grant or reactivate SUPER_ADMIN', 'Revoke all target account sessions; require fresh sign-in', 'Write operator/reference audit record atomically'] };
    if (!options.apply) return { ...plan, applied: false };
    if (options.expectedState !== state) fail('Preview is stale or belongs to a different target/review. Preview and review again.');
    const before = await tx.userRole.findUnique({ where: { userId_roleId: { userId: user.id, roleId: role.id } } });
    const grant = await tx.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: { active: true, assignedAt: new Date() }, create: { userId: user.id, roleId: role.id, active: true } });
    const revoked = await tx.authSession.deleteMany({ where: { userId: user.id } });
    const audit = await tx.auditLog.create({ data: { actorId: `operator:${options.operator}`, action: `admin.${options.mode}`, entityType: 'UserRole', entityId: grant.id,
      beforeData: { active: before?.active ?? false, existed: !!before }, afterData: { userId: user.id, roleName: 'SUPER_ADMIN', reference: options.reference, reviewed: true, sessionsRevoked: revoked.count, previewState: state } } });
    return { ...plan, applied: true, auditId: audit.id, sessionsRevoked: revoked.count };
  }, { maxWait: 10000, timeout: 15000 });
}
module.exports = { provisionAdmin, validate, targetIdentity, ProvisioningError };
