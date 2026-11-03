const { httpError } = require('../lib/errors');
const { getPrisma } = require('../lib/prisma');
const { getUserEnergySummary } = require('../services/energySummary');
const asyncRouter = require('../lib/asyncRouter');

const router = asyncRouter();

// GET /energy/summary?date=YYYY-MM-DD&tz=IANA
// The single versioned energy contract for web + mobile. Wearable not required —
// profile estimates are labeled as such; missing data is null, never zero.
router.get('/summary', async (req, res) => {
  const userId = req.userId || req.headers['x-user-id'];
  if (!userId) throw httpError(401, 'Sign in required');
  const summary = await getUserEnergySummary(getPrisma(), userId, {
    date: req.query.date,
    timeZone: req.query.tz,
  });
  if (!summary) throw httpError(404, 'User not found');
  res.json(summary);
});

module.exports = router;
