const router = require('express').Router();
router.post('/redeem', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await require('../services/legacyMigration').redeemGrant(req.userId, req.headers.authorization?.slice(7), req.body)); }
  catch (e) { next(e); }
});
module.exports = router;
