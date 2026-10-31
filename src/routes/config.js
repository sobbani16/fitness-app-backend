// Authenticated feature configuration endpoint consumed by the mobile app.
// Identity comes from the verified session only (req.userId set by
// authenticate middleware) — never from client-supplied IDs.
const express = require('express');
const flags = require('../services/featureFlags/service');
const { getUserId } = require('../middleware/rbac');

const router = express.Router();
const CONFIG_VERSION = '1';

router.get('/features', async (req, res, next) => {
  try {
    const features = await flags.clientConfig(getUserId(req));
    // Per-user config: shared caches must not serve another user's flags.
    res.set('Cache-Control', 'private, max-age=30');
    res.json({ configVersion: CONFIG_VERSION, refreshAfterSeconds: 60, features });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
