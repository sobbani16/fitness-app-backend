const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { logCheckIn, getWellnessSummary } = require('../services/wellness');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();
router.use(requireFeature('stress_wellness'));
const uid = req => req.user?.id || req.userId || req.headers['x-user-id'];

router.post('/check-ins', async (req, res, next) => {
  try { res.status(201).json(await logCheckIn(uid(req), req.body || {})); } catch (e) { next(e); }
});
router.get('/check-ins', async (req, res, next) => {
  try {
    res.json({ checkIns: await getPrisma().wellnessCheckIn.findMany({ where: { userId: uid(req) }, orderBy: { loggedAt: 'desc' }, take: 60 }) });
  } catch (e) { next(e); }
});
router.get('/summary', async (req, res, next) => {
  try { res.json(await getWellnessSummary(uid(req))); } catch (e) { next(e); }
});

module.exports = router;
