const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { getGutHealthSummary, logSymptom, setTolerance } = require('../services/gutHealth');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();
router.use(requireFeature('gut_health'));
const uid = req => req.user?.id || req.userId || req.headers['x-user-id'];

router.get('/summary', async (req, res, next) => {
  try { res.json(await getGutHealthSummary(uid(req))); } catch (e) { next(e); }
});

router.post('/symptoms', async (req, res, next) => {
  try { res.status(201).json(await logSymptom(uid(req), req.body || {})); } catch (e) { next(e); }
});
router.get('/symptoms', async (req, res, next) => {
  try {
    res.json({ symptoms: await getPrisma().gutSymptom.findMany({ where: { userId: uid(req) }, orderBy: { loggedAt: 'desc' }, take: 90 }) });
  } catch (e) { next(e); }
});

router.post('/tolerances', async (req, res, next) => {
  try { res.status(201).json(await setTolerance(uid(req), req.body || {})); } catch (e) { next(e); }
});
router.get('/tolerances', async (req, res, next) => {
  try {
    res.json({ tolerances: await getPrisma().foodTolerance.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 100 }) });
  } catch (e) { next(e); }
});
router.delete('/tolerances/:id', async (req, res, next) => {
  try {
    await getPrisma().foodTolerance.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
