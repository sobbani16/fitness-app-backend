// Single authoritative fetch+resolve path for the personalized fiber target.
// Every surface that needs a user's fiber target should call this — it owns
// which inputs the resolver reads (profile, MacroGoal, active conditions) so
// surfaces cannot drift into different target values for the same user.
const { resolveFiberTarget } = require('./targets');

/**
 * @param {object} prisma
 * @param {string} userId
 * @returns {Promise<ReturnType<typeof resolveFiberTarget>>}
 */
async function resolveFiberTargetForUser(prisma, userId) {
  const [user, macroGoal, conditions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, gender: true } }).catch(() => null),
    prisma.macroGoal.findUnique({ where: { userId } }).catch(() => null),
    prisma.userHealthCondition.findMany({
      where: { userId, active: true },
      include: { condition: { select: { name: true } } },
    }).catch(() => []),
  ]);
  return resolveFiberTarget({
    dateOfBirth: user?.dateOfBirth, gender: user?.gender, macroGoal,
    conditionNames: (conditions || []).map((c) => c.condition?.name).filter(Boolean),
  });
}

module.exports = { resolveFiberTargetForUser };
