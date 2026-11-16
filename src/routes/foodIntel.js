// Food Intelligence routes — /food-intel/*. Member-scoped; deterministic
// suitability + reviewed evidence only (no AI-generated claims).
const express = require('express');
const svc = require('../services/foodIntel');
const { requireFeature } = require('../middleware/requireFeature');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(requireFeature('food_intelligence_enabled'));

const uid = (req) => req.userId || req.user?.id;

router.get('/barcode/:code', wrap(async (req, res) => res.json(await svc.resolveBarcode(req.params.code))));
router.post('/barcode', wrap(async (req, res) => res.status(201).json({ product: await svc.upsertBarcodeProduct(uid(req), req.body || {}) })));

router.get('/evidence', requireFeature('ingredient_evidence_enabled'), wrap(async (req, res) => res.json({ ingredients: await svc.listEvidence() })));
router.get('/evidence/:key', requireFeature('ingredient_evidence_enabled'), wrap(async (req, res) => res.json(await svc.getEvidence(req.params.key))));
router.get('/explain/:key', requireFeature('ingredient_evidence_enabled'), wrap(async (req, res) => res.json(await svc.explainIngredient(req.params.key, req.query.q))));

router.post('/suitability', wrap(async (req, res) => res.json(await svc.checkSuitability(uid(req), req.body || {}))));
router.post('/scan-result', wrap(async (req, res) => res.json(await svc.scanResult(uid(req), req.body || {}))));
router.post('/alternatives', wrap(async (req, res) => res.json(await svc.alternatives(uid(req), req.body || {}))));
router.post('/log', wrap(async (req, res) => res.status(201).json({ foodLog: await svc.logScannedFood(uid(req), req.body || {}) })));

module.exports = router;
