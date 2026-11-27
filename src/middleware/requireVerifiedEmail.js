const { getPrisma } = require('../lib/prisma');
const { isProduction } = require('../lib/env');
module.exports = async (req, res, next) => {
  // Same production-impossibility rule as authenticate.js — Railway-aware veto.
  if (process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true' && !isProduction()) return next();
  try {
    const user = await getPrisma().user.findUnique({ where: { id: req.userId }, select: { emailVerifiedAt: true } });
    if (!user?.emailVerifiedAt) return res.status(403).json({ error: 'Verify your email before continuing.', code: 'EMAIL_NOT_VERIFIED' });
    next();
  } catch (e) { next(e); }
};
