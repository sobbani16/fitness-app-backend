const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const commerce = require('../services/trainerCommerceService');
const audit = require('../services/auditService');

const router = express.Router();
// Mounted at /me — flag + authenticated identity required for every route.
router.use(requireFeature('trainer_paid_coaching_enabled'), identifyUser);

// GET /me/entitlements — caller's active/spent entitlements
router.get('/entitlements', async (req, res) => {
  try {
    const entitlements = await commerce.listEntitlements(req.userId);
    res.json({ entitlements });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /me/purchases/checkout — start a checkout. Returns the pending purchase;
// it only becomes 'paid' when the provider webhook confirms payment.
router.post('/purchases/checkout', async (req, res) => {
  try {
    const { packageId, idempotencyKey } = req.body || {};
    const { purchase, checkout } = await commerce.createPurchase(req.userId, { packageId, idempotencyKey });
    if (!checkout.reused) {
      await audit.log({
        actorId: req.userId,
        action: 'purchase.checkout_created',
        entityType: 'TrainerPurchase',
        entityId: purchase.id,
        afterData: { purchaseId: purchase.id, packageId, amountCents: purchase.amountCents, currency: purchase.currency, status: purchase.status },
      });
    }
    res.status(checkout.reused ? 200 : 201).json({ purchase, checkout });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /me/purchases — caller's purchase history
router.get('/purchases', async (req, res) => {
  try {
    const purchases = await commerce.listPurchases(req.userId);
    res.json({ purchases });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
