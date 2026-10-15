const router = require('express').Router();
const { POLICY, exportAccount, deleteAccount } = require('../services/accountData');
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/retention', (req, res) => res.json(POLICY));
router.post('/export', async (req, res, next) => {
  try {
    const data = await exportAccount(req.userId, req.headers.authorization?.slice(7), req.body?.password);
    res.set('Content-Disposition', 'attachment; filename="fitness-account.json"').json(data);
  } catch (e) { next(e); }
});
router.post('/delete', async (req, res, next) => {
  try { res.json(await deleteAccount(req.userId, req.headers.authorization?.slice(7), req.body?.password, req.body?.confirmation)); }
  catch (e) { next(e); }
});
module.exports = router;
