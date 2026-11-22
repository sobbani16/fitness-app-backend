const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { getReview, setOpt, markOpened, listHistory } = require('../services/weeklyHealthReview');

const router = express.Router();
router.use(requireFeature('weekly_health_review_enabled'));
const uid = (req) => req.user?.id || req.userId || req.headers['x-user-id'];

// Current week (default) or ?weekOf=YYYY-MM-DD — generates on demand.
router.get('/', async (req, res, next) => {
  try {
    res.json(await getReview(uid(req), { tz: req.query.tz, weekOf: req.query.weekOf }));
  } catch (e) { next(e); }
});
router.get('/history', async (req, res, next) => {
  try { res.json(await listHistory(uid(req))); } catch (e) { next(e); }
});
router.put('/opt', async (req, res, next) => {
  try { res.json(await setOpt(uid(req), req.body || {})); } catch (e) { next(e); }
});
router.post('/:weekOf/open', async (req, res, next) => {
  try { res.json(await markOpened(uid(req), req.params.weekOf)); } catch (e) { next(e); }
});

module.exports = router;
