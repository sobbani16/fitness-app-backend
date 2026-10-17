const express = require('express');
const { randomUUID } = require('node:crypto');
const { extractNutritionFromText, adjustPortion, saveScannedLabel, getUserLabels } = require('../services/labelScannerService');
const router = express.Router();
const invalid = message => Object.assign(new Error(message), { status: 400 });
function userId(req) { return req.userId || String(req.headers['x-user-id'] || '').trim(); }
function fail(res, error) {
  const status = error.status || 500;
  res.status(status).json({ error: status >= 500 ? 'Label service unavailable. Please retry.' : error.message });
}
function number(value, name, optional = false, maximum = 100000) {
  if (optional && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw invalid(`Review ${name}`);
  return value;
}
function text(value, name, maximum) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || value.length > maximum) throw invalid(`Invalid ${name}`);
  return value;
}
router.post('/extract', async (req, res) => {
  try {
    const ocrText = text(req.body?.ocrText, 'label text', 20000);
    if (!ocrText?.trim()) throw invalid('Label text is required');
    res.json({ extracted: await extractNutritionFromText(ocrText) });
  } catch (error) { fail(res, error); }
});
router.post('/adjust', (req, res) => {
  try {
    const b = req.body || {};
    const nutrition = {};
    for (const name of ['calories','proteinG','carbsG','fatG','fiberG','sugarG']) nutrition[name] = number(b[name], name, ['fiberG','sugarG'].includes(name));
    res.json({ adjusted: adjustPortion(nutrition, number(b.servingSizeG, 'serving mass', false, 10000), number(b.actualPortionG, 'portion mass', false, 10000)) });
  } catch (error) { fail(res, error); }
});
router.post('/save', async (req, res) => {
  try {
    const owner = userId(req);
    if (!owner) throw invalid('Authenticated account required');
    const b = req.body || {}, id = b.id ?? randomUUID(); // Existing clients can still submit without an id.
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw invalid('Invalid label id');
    const data = { id, servingSizeG: number(b.servingSizeG, 'serving mass', false, 10000), actualPortionG: number(b.actualPortionG, 'portion mass', false, 10000),
      servingsPerContainer: number(b.servingsPerContainer, 'package servings', true), aiConfidence: number(b.aiConfidence, 'extraction confidence', true, 1) };
    for (const name of ['labelCalories','labelProteinG','labelCarbsG','labelFatG','labelFiberG','labelSugarG','labelSodiumMg']) {
      data[name] = number(b[name], name, ['labelFiberG','labelSugarG','labelSodiumMg'].includes(name));
    }
    for (const [name, maximum] of [['productName',300],['ingredients',20000],['photoUri',4096],['ocrRawText',20000],['mealType',30]]) data[name] = text(b[name], name, maximum);
    res.status(201).json(await saveScannedLabel(owner, data));
  } catch (error) { fail(res, error); }
});
router.get('/history', async (req, res) => {
  try {
    const owner = userId(req);
    if (!owner) throw invalid('Authenticated account required');
    const limit = req.query.limit == null ? 20 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Limit must be between 1 and 100');
    res.json({ labels: await getUserLabels(owner, limit) });
  } catch (error) { fail(res, error); }
});
module.exports = router;
