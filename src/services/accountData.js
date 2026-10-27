const { getPrisma } = require('../lib/prisma');
const { verifyPassword, hashToken } = require('./authService');
const { consumeLimit } = require('./authLifecycle');
const { httpError } = require('../lib/errors');

// Explicit ownership registry. The schema-coverage test fails when a new model is unclassified.
const OWNED = [
  'userHealthProfile', 'userHealthCondition', 'userAllergy', 'weightEntry', 'dailySteps',
  'waterLog', 'sleepLog', 'foodLog', 'workoutSession', 'recommendation', 'userInsight', 'userEvent',
  'supplementLog', 'userSupplement', 'userIngredient', 'recommendationViolation', 'mealRecommendation',
  'safetyAuditLog', 'supplementSchedule', 'dailyCoachingMessage', 'userRole', 'trainerWaitlist',
  'macroGoal', 'dailyMacroScore', 'healthScore', 'userPlanningPreferences', 'foodPreference',
  'foodInventory', 'dietAdherenceScore', 'calorieAdjustmentHistory', 'weeklyReview', 'weeklyNutritionPlan',
  'notification', 'scannedLabel', 'apiUsage',
];
const INCLUDES = {
  workoutSession: { exerciseSets: true },
  healthScore: { contributors: true, insights: true },
  mealRecommendation: { violations: true },
  weeklyNutritionPlan: { meals: true, shoppingList: { include: { items: true } } },
  weeklyReview: { recommendations: true },
  userRole: { role: true },
};
const POLICY = Object.freeze({ version: '2026-10-18', liveData: 'Deleted immediately when the transaction completes; no recovery grace period.',
  backups: 'Hosting must enforce a maximum of 30 days for backups and operational logs. Restores must replay deletion receipts before serving traffic.',
  receipts: 'Account ID and deletion time only, retained for 35 days for backup restore suppression.',
  audit: 'Operational audit records expire after 30 days at hourly maintenance. Bootstrap completion retains only a non-personal marker to prevent bootstrap reuse. Account deletion removes related audit records immediately.',
  exports: 'No server-side export file is retained. Copies you save or share are under your control.',
  relatedRecords: 'Coaching assignments, plans and notes involving this account are removed. Shared food catalogs and other users’ independent health records remain.',
  devices: 'This device clears its account caches. Other devices clear caches when they next contact the service; offline devices and OS backups cannot be remotely erased.',
  providers: 'Email and AI provider copies follow their configured retention policies; provider and backup retention must be verified before release.' });
function recordIds(rows) {
  const ids = [];
  const visit = row => {
    if (!row || typeof row !== 'object') return;
    if (Array.isArray(row)) return row.forEach(visit);
    if (typeof row.id === 'string') ids.push(row.id);
    for (const key of ['exerciseSets', 'contributors', 'insights', 'violations', 'meals', 'shoppingList', 'items', 'recommendations', 'exercises', 'ingredients', 'analytics']) visit(row[key]);
  };
  visit(rows); return ids;
}
async function reauthenticate(tx, userId, token, password) {
  const users = await tx.$queryRaw`SELECT * FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = users[0];
  const session = await tx.authSession.findUnique({ where: { tokenHash: hashToken(token || '') } });
  if (!user || !session || session.userId !== userId || session.expiresAt <= new Date()) throw httpError(401, 'Sign in again.');
  if (typeof password !== 'string' || password.length > 128 || !await verifyPassword(password, user.passwordHash)) throw httpError(403, 'Current password is incorrect.');
  return user;
}
async function limit(userId, operation) {
  if (!await consumeLimit(`account:${operation}`, userId, 5, 15 * 60000)) throw httpError(429, 'Too many account requests. Try again in 15 minutes.');
}
async function exportAccount(userId, token, password) {
  await limit(userId, 'export');
  return getPrisma().$transaction(async tx => {
    const user = await reauthenticate(tx, userId, token, password);
    const { passwordHash, ...profile } = user;
    const data = { profile };
    for (const model of OWNED) data[model] = await tx[model].findMany({ where: { userId }, ...(INCLUDES[model] ? { include: INCLUDES[model] } : {}) });
    data.trainerProfile = await tx.trainerProfile.findUnique({ where: { userId } });
    data.nutritionistProfile = await tx.nutritionistProfile.findUnique({ where: { userId } });
    data.creatorProfile = await tx.creatorProfile.findUnique({ where: { userId }, include: { analytics: true } });
    const creatorIds = [userId, data.creatorProfile?.id].filter(Boolean);
    data.recipes = await tx.recipe.findMany({ where: { creatorId: { in: creatorIds } }, include: { ingredients: true } });
    data.trainerAssignments = await tx.trainerClient.findMany({ where: { clientId: userId } });
    data.nutritionistAssignments = await tx.nutritionistClient.findMany({ where: { clientId: userId } });
    data.workoutPlans = await tx.workoutPlan.findMany({ where: { clientId: userId }, include: { exercises: true } });
    data.mealPlans = await tx.mealPlan.findMany({ where: { clientId: userId }, include: { items: true } });
    data.trainerDropForms = await tx.trainerDropForm.findMany({ where: { clientId: userId, droppedBy: 'client' } });
    data.sessions = await tx.authSession.findMany({ where: { userId }, select: { createdAt: true, expiresAt: true } });
    data.emailActions = await tx.authAction.findMany({ where: { userId }, select: { purpose: true, createdAt: true, expiresAt: true, consumedAt: true, deliveredAt: true } });
    data.coachNotes = await tx.coachNote.findMany({ where: { clientId: userId, visibility: 'client_visible' } });
    // Private coach notes and other clients' information are intentionally not exported.
    const output = { formatVersion: 1, exportedAt: new Date().toISOString(), retention: POLICY, data };
    if (Buffer.byteLength(JSON.stringify(output)) > 50 * 1024 * 1024) throw httpError(413, 'This export exceeds the online limit. Contact support for a full export.');
    return output;
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
}
async function deleteAccount(userId, token, password, confirmation) {
  if (confirmation !== 'DELETE') throw httpError(400, 'Type DELETE to confirm permanent deletion.');
  await limit(userId, 'delete');
  return getPrisma().$transaction(async tx => {
    const user = await reauthenticate(tx, userId, token, password);
    // Serialize audit inserts while scrubbing snapshots and recording the deletion.
    await tx.$executeRaw`LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE`;
    const trainer = await tx.trainerProfile.findUnique({ where: { userId } });
    const nutritionist = await tx.nutritionistProfile.findUnique({ where: { userId } });
    const creator = await tx.creatorProfile.findUnique({ where: { userId } });
    const trainerIds = trainer ? [trainer.id] : [], nutritionistIds = nutritionist ? [nutritionist.id] : [];
    const identifiers = [userId, user.email, ...trainerIds, ...nutritionistIds, ...(creator ? [creator.id] : [])];
    const relations = [
      ['coachNote', { OR: [{ clientId: userId }, { coachId: userId }, { trainerId: { in: trainerIds } }, { nutritionistId: { in: nutritionistIds } }] }],
      ['trainerDropForm', { OR: [{ clientId: userId }, { trainerId: { in: trainerIds } }] }],
      ['workoutPlan', { OR: [{ clientId: userId }, { trainerId: { in: trainerIds } }] }],
      ['mealPlan', { OR: [{ clientId: userId }, { nutritionistId: { in: nutritionistIds } }] }],
      ['trainerClient', { OR: [{ clientId: userId }, { trainerId: { in: trainerIds } }] }],
      ['nutritionistClient', { OR: [{ clientId: userId }, { nutritionistId: { in: nutritionistIds } }] }],
      ['trainerWaitlist', { OR: [{ userId }, { trainerId: { in: trainerIds } }] }],
    ];
    for (const [model, where] of relations) {
      const include = model === 'workoutPlan' ? { exercises: true } : model === 'mealPlan' ? { items: true } : undefined;
      const rows = await tx[model].findMany({ where, ...(include ? { include } : {}) });
      identifiers.push(...recordIds(rows));
      await tx[model].deleteMany({ where });
    }
    const recipes = await tx.recipe.findMany({ where: { creatorId: { in: [userId, ...(creator ? [creator.id] : [])] } }, include: { ingredients: true } });
    identifiers.push(...recordIds(recipes));
    const recipeIds = recipes.map(row => row.id); identifiers.push(...recipeIds);
    // Preserve other members' meal snapshots, removing only the reference to the deleted recipe.
    await tx.weeklyMeal.updateMany({ where: { recipeId: { in: recipeIds } }, data: { recipeId: null } });
    await tx.recipe.deleteMany({ where: { id: { in: recipeIds } } });
    identifiers.push(...recordIds(await tx.exerciseSet.findMany({ where: { workoutSession: { userId } } })));
    await tx.exerciseSet.deleteMany({ where: { workoutSession: { userId } } });
    for (const model of OWNED) {
      if (model !== 'apiUsage') {
        const rows = await tx[model].findMany({ where: { userId }, ...(INCLUDES[model] ? { include: INCLUDES[model] } : {}) });
        identifiers.push(...recordIds(rows));
      }
      await tx[model].deleteMany({ where: { userId } });
    }
    await tx.trainerProfile.deleteMany({ where: { userId } });
    await tx.nutritionistProfile.deleteMany({ where: { userId } });
    await tx.creatorProfile.deleteMany({ where: { userId } });
    // Audit snapshots may refer to this account as subject even when a different admin was the actor.
    await tx.$executeRaw`DELETE FROM "AuditLog" WHERE EXISTS (
      SELECT 1 FROM unnest(${identifiers}::text[]) AS ident WHERE strpos(to_jsonb("AuditLog")::text, ident) > 0)`;
    const bucketKeys = [
      `email:reset-password:${user.email}`, `email:verify-email:${user.email}`, `login-email:${user.email}`,
      `account:export:${userId}`, `account:delete:${userId}`, `legacy-migration:${userId}`,
    ].map(hashToken);
    await tx.authRateBucket.deleteMany({ where: { key: { in: bucketKeys } } });
    await tx.legacyMigrationGrant.deleteMany({ where: { OR: [{ legacyUserId: userId }, { targetUserId: userId }] } });
    const deletedAt = new Date();
    await tx.accountDeletionReceipt.create({ data: { userId, deletedAt, expiresAt: new Date(deletedAt.getTime() + 35 * 86400000) } });
    await tx.user.delete({ where: { id: userId } }); // Cascades sessions and queued auth emails.
    return { deleted: true, deletedAt: deletedAt.toISOString(), policyVersion: POLICY.version };
  }, { timeout: 60000 });
}
module.exports = { OWNED, INCLUDES, POLICY, exportAccount, deleteAccount };
