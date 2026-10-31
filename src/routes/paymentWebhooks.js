const express = require('express');
const commerce = require('../services/trainerCommerceService');

const router = express.Router();

// PUBLIC endpoint — mounted before the authenticate middleware in app.js.
// Trust comes from the provider's HMAC signature, never from session identity.
// The app parses JSON globally (no raw-body capture), so MockProvider signs
// JSON.stringify(req.body) and verifies against that same serialization —
// see src/services/payments/provider.js.
router.post('/:provider', async (req, res) => {
  try {
    const rawBody = JSON.stringify(req.body || {});
    const result = await commerce.handleWebhookEvent(req.params.provider, req.headers, rawBody);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
