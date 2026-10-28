const express = require('express');
const { randomUUID } = require('node:crypto');
const { extractNutritionFromText, adjustPortion, saveScannedLabel, getUserLabels } = require('../services/labelScannerService');
const { classify } = require('../services/documentClassifier');
const { mergeLabelPanels } = require('../services/labelMerge');
const { parseMenuText } = require('../services/menuParser');
const { enrichMenuItems } = require('../services/menuNutrition');
const { getPrisma } = require('../lib/prisma');
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
// POST /label-scanner/classify — decides food-label vs menu vs unsupported
// before any nutrition extraction. Never returns the raw text back.
router.post('/classify', (req, res) => {
  try {
    const ocrText = text(req.body?.ocrText, 'document text', 20000);
    if (!ocrText?.trim()) throw invalid('Document text is required');
    res.json(classify(ocrText, { hint: req.body?.hint === 'menu' ? 'menu' : undefined }));
  } catch (error) { fail(res, error); }
});
// POST /label-scanner/menu — classifies menu text then parses items and
// enriches each with nutrition provenance. Supports multiple page texts.
router.post('/menu', async (req, res) => {
  try {
    const texts = Array.isArray(req.body?.pages) ? req.body.pages.slice(0, 6) : [req.body?.ocrText];
    const cleaned = texts.map((t, i) => text(t, `page ${i + 1} text`, 20000)).filter(t => t?.trim());
    if (!cleaned.length) throw invalid('Menu text is required');
    const owner = userId(req);
    if (!owner) throw invalid('Authenticated account required');
    const prisma = getPrisma();
    const merged = { restaurant: req.body?.restaurantName || null, items: [] };
    const seen = new Set();
    for (const page of cleaned) {
      const c = classify(page, { hint: 'menu' });
      if (c.type === 'UNSUPPORTED') continue;
      const parsed = parseMenuText(page, { restaurantName: merged.restaurant });
      if (parsed.restaurant && !merged.restaurant) merged.restaurant = parsed.restaurant;
      for (const item of parsed.items) {
        const key = item.name.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.items.push(item);
      }
    }
    if (!merged.items.length) throw invalid('No menu items found. Retake the photo or enter a dish manually.');
    const items = await enrichMenuItems(prisma, merged.items);
    res.json({ restaurant: merged.restaurant, items });
  } catch (error) { fail(res, error); }
});
// POST /label-scanner/extract-merged — merges structured fields across multiple
// images of one product with field-level provenance and conflict reporting.
router.post('/extract-merged', async (req, res) => {
  try {
    const owner = userId(req);
    if (!owner) throw invalid('Authenticated account required');
    const panels = req.body?.panels;
    if (!panels || typeof panels !== 'object') throw invalid('Panel text is required');
    const allowed = ['nutrition', 'ingredients', 'allergens', 'claims', 'front'];
    const cleaned = {};
    for (const key of allowed) {
      const list = Array.isArray(panels[key]) ? panels[key].slice(0, 4) : [panels[key]];
      const texts = list.map((t, i) => text(t, `${key} image ${i + 1} text`, 20000)).filter(t => t?.trim());
      if (texts.length) cleaned[key] = texts.length > 1 ? texts : texts[0];
    }
    if (!Object.keys(cleaned).length) throw invalid('At least one panel is required');
    res.json(await mergeLabelPanels(cleaned));
  } catch (error) { fail(res, error); }
});
router.post('/compare', (req, res) => {
  try { res.json(require('../services/labelInsights').compare(req.body?.first, req.body?.second)); }
  catch (error) { fail(res, error); }
});
router.post('/insights', async (req, res) => {
  try { res.json(await require('../services/labelInsights').analyzeForUser(req.body, userId(req))); }
  catch (error) { fail(res, error); }
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
    for (const name of ['extraction', 'userCorrections']) {
      if (b[name] == null) continue;
      if (typeof b[name] !== 'object' || Array.isArray(b[name])) throw invalid(`${name} must be an object`);
      if (JSON.stringify(b[name]).length > 40000) throw invalid(`${name} too large`);
      data[name] = b[name];
    }
    if (b.labelFacts != null) {
      const facts = require('../services/labelInsights').validate(b.labelFacts);
      if (!facts.reviewed || facts.ingredients !== (data.ingredients || '') || facts.carbsG !== data.labelCarbsG || facts.sugarG !== data.labelSugarG || facts.fiberG !== data.labelFiberG || facts.calories !== data.labelCalories || facts.proteinG !== data.labelProteinG || facts.sodiumMg !== data.labelSodiumMg || Math.abs(facts.portionRatio - data.actualPortionG / data.servingSizeG) > 0.000001 || (facts.basisUnit === 'g' && facts.basisAmount !== data.servingSizeG)) throw invalid('Insights must match the reviewed meal');
      data.labelInsights = await require('../services/labelInsights').analyzeForUser(facts, owner);
    }
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
