// Leo tool registrations — real handlers wired to existing services.
// Identity is server-bound (ctx.userId/sessionId injected by the registry);
// handlers receive a copy of args only.
const { getPrisma } = require('../../lib/prisma');
const registry = require('./toolRegistry');
const { CATEGORIES } = registry;

let registered = false;

function ensureRegistered() {
  if (registered) return;
  registered = true;
  const prisma = getPrisma();

  registry.register({
    name: 'progress.today', version: '1', category: CATEGORIES.READ,
    description: "Today's logged meals, water, steps, and workout totals.",
    inputSchema: {},
    timeoutMs: 5000,
    handler: async (_args, { userId }) => {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [meals, water, steps] = await Promise.all([
        prisma.foodLog.findMany({ where: { userId, loggedAt: { gte: start } }, select: { foodName: true, mealType: true, calories: true, proteinG: true } }),
        prisma.waterIntake.aggregate({ where: { userId, loggedAt: { gte: start } }, _sum: { amountMl: true } }).catch(() => ({ _sum: {} })),
        prisma.dailySteps.findFirst({ where: { userId, date: { gte: start } }, select: { steps: true } }).catch(() => null),
      ]);
      return {
        meals: meals.map((m) => ({ foodName: m.foodName, mealType: m.mealType, calories: m.calories })),
        caloriesTotal: Math.round(meals.reduce((s, m) => s + (m.calories || 0), 0)),
        waterMl: water._sum?.amountMl || 0,
        steps: steps?.steps || null,
      };
    },
  });

  registry.register({
    name: 'session.close', version: '1', category: CATEGORIES.SENSITIVE,
    description: 'End the current Leo session. Requires confirmation.',
    inputSchema: {},
    timeoutMs: 5000,
    handler: async (_args, { userId, sessionId }) => {
      const r = await prisma.leoSession.updateMany({
        where: { id: sessionId, userId, status: 'active' },
        data: { status: 'ended', endedAt: new Date() },
      });
      if (!r.count) throw Object.assign(new Error('session_not_active'), { status: 409 });
      return { closed: true, sessionId };
    },
  });

  registry.register({
    name: 'session.purge', version: '1', category: CATEGORIES.DESTRUCTIVE,
    description: 'Hard-delete the session and its messages. Requires confirmation.',
    inputSchema: {},
    timeoutMs: 5000,
    handler: async (_args, { userId, sessionId }) => {
      const own = await prisma.leoSession.findFirst({ where: { id: sessionId, userId } });
      if (!own) throw Object.assign(new Error('session_not_found'), { status: 404 });
      const msgs = await prisma.leoMessage.deleteMany({ where: { sessionId } });
      await prisma.leoSession.delete({ where: { id: sessionId } });
      return { purged: true, messagesDeleted: msgs.count };
    },
  });
}

module.exports = { ensureRegistered };

// session-lifecycle invalidation: closing or purging a session invalidates
// its pending confirmations — an approval given in a session context must
// not be executable after that context is gone.
require('./toolRegistry').registerMutationHook(async ({ tool, sessionId }) => {
  if (tool === 'session.close' || tool === 'session.purge') {
    await require('./confirmations').invalidateSession(sessionId).catch(() => null);
  }
});
