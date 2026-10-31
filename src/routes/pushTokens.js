const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const push = require('../services/pushService');

const router = express.Router();

router.use(identifyUser);

// POST /me/push-tokens { token, platform } — register/refresh a device token
router.post('/', async (req, res) => {
  try {
    const row = await push.registerToken(req.userId, req.body || {});
    res.status(201).json(row);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /me/push-tokens/:token — unregister one of the caller's tokens
router.delete('/:token', async (req, res) => {
  try {
    res.json(await push.removeToken(req.userId, req.params.token));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
