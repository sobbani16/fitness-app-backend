const express = require('express');
const { requireRole } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const commerce = require('../services/trainerCommerceService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
// Paid-coaching flag gates the whole commerce surface; TRAINER role applies
// on top (requireFeature resolves the user id from x-user-id itself).
router.use(requireFeature('trainer_paid_coaching_enabled'), requireRole('TRAINER'));

// ---------------------------------------------------------------------------
// Package CRUD (trainer-owned)
// ---------------------------------------------------------------------------

// POST /trainer/commerce/packages — create a coaching package
router.post('/packages', async (req, res) => {
  try {
    const pkg = await coachingTransaction(async (tx) => {
      const pkg = await commerce.createPackage(req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer_package.created',
        entityType: 'TrainerCoachingPackage',
        entityId: pkg.id,
        afterData: { packageId: pkg.id, amountCents: pkg.priceCents, currency: pkg.currency, status: 'active' },
      }, tx);
      return pkg;
    });
    res.status(201).json(pkg);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /trainer/commerce/packages — trainer's packages (?active=1 for sellable only)
router.get('/packages', async (req, res) => {
  try {
    const packages = await commerce.listPackages(req.userId, { activeOnly: req.query.active === '1' || req.query.active === 'true' });
    res.json({ packages });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /trainer/commerce/packages/:id — update a package (kind is immutable)
router.patch('/packages/:id', async (req, res) => {
  try {
    const pkg = await coachingTransaction(async (tx) => {
      const pkg = await commerce.updatePackage(req.userId, req.params.id, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer_package.updated',
        entityType: 'TrainerCoachingPackage',
        entityId: pkg.id,
        afterData: { packageId: pkg.id, status: pkg.active ? 'active' : 'inactive' },
      }, tx);
      return pkg;
    });
    res.json(pkg);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// DELETE /trainer/commerce/packages/:id — deactivate (never hard-delete: history)
router.delete('/packages/:id', async (req, res) => {
  try {
    const pkg = await coachingTransaction(async (tx) => {
      const pkg = await commerce.deactivatePackage(req.userId, req.params.id, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer_package.deactivated',
        entityType: 'TrainerCoachingPackage',
        entityId: pkg.id,
        afterData: { packageId: pkg.id, status: 'inactive' },
      }, tx);
      return pkg;
    });
    res.json(pkg);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Sales & payouts
// ---------------------------------------------------------------------------

// GET /trainer/commerce/purchases — purchases of this trainer's packages
router.get('/purchases', async (req, res) => {
  try {
    const purchases = await commerce.listTrainerPurchases(req.userId);
    res.json({ purchases });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /trainer/commerce/payouts — recorded payouts (stub until payout execution lands)
router.get('/payouts', async (req, res) => {
  try {
    const payouts = await commerce.listPayouts(req.userId);
    res.json({ payouts });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /trainer/commerce/purchases/:purchaseId/refund — refund a paid purchase
router.post('/purchases/:purchaseId/refund', async (req, res) => {
  try {
    const { amountCents, reason } = req.body || {};
    const result = await commerce.refundPurchase(req.userId, req.params.purchaseId, { amountCents, reason });
    await audit.log({
      actorId: req.userId,
      action: 'purchase.refunded',
      entityType: 'TrainerPurchase',
      entityId: req.params.purchaseId,
      afterData: { purchaseId: req.params.purchaseId, amountCents: result.amountCents, currency: result.currency, status: 'refunded' },
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
