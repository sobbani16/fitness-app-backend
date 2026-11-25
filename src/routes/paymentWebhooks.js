const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const commerce = require('../services/trainerCommerceService');

const router = express.Router();

// PUBLIC endpoint — mounted before the authenticate middleware in app.js, so
// the app-level IP limiter doesn't cover it. Trust comes from the provider's
// HMAC signature; this ceiling bounds unauthenticated DB work per address.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.WEBHOOK_RATE_LIMIT || 120),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => res.status(429).json({ error: 'Too many requests.' }),
});
router.use(webhookLimiter);

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
