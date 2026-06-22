const { getPrisma } = require('../lib/prisma');

/**
 * Ensure a User record exists for the device id passed in x-user-id.
 * The mobile app currently uses anonymous device ids, so we create a
 * placeholder user with a generated email when one is missing. This allows
 * foreign-key-dependent tables (FoodLog, WaterLog, DailySteps, etc.) to sync.
 */
async function ensureUser(req, res, next) {
  const userId = (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
  if (!userId) return next();

  const prisma = getPrisma();
  try {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@device.local`,
        },
      });
    }
  } catch (err) {
    // Don't block the request; log and continue. Failure will surface as FK error if still missing.
    console.error('ensureUser failed:', err.message);
  }
  next();
}

module.exports = { ensureUser };
