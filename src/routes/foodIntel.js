// Food Intelligence routes — /food-intel/*. Member-scoped; deterministic
// suitability + reviewed evidence only (no AI-generated claims).
const express = require('express');
const svc = require('../services/foodIntel');
const { requireFeature } = require('../middleware/requireFeature');

const router = express.Router();
router.use(requireFeature('food_intelligence_enabled'));

const uid = (req) => req.userId || req.user.id;

router.get('/barcode/:code', async (req, res) => res.json(await svc.resolveBarcode(req.params.code)));
router.post('/barcode', async (req, res) => res.status(201).json({ product: await svc.upsertBarcodeProduct(uid(req), req.body || {}) }));

// Ingredient evidence — gated additionally on ingredient_evidence_enabled
router.get('/evidence', requireFeature('ingredient_evidence_enabled'), async (req, res) => res.json({ ingredients: await svc.listEvidence() }));
router.get('/evidence/:key', requireFeature('ingredient_evidence_enabled'), async (req, res) => res.json(await svc.getEvidence(req.params.key)));

// Deterministic suitability + composed scan result
router.post('/suitability', async (req, res) => res.json(await svc.checkSuitability(uid(req), req.body || {})));
router.post('/scan-result', async (req, res) => res.json(await svc.scanResult(uid(req), req.body || {})));

module.exports = router;
