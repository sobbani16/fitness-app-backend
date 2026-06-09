const express = require('express');
const {
  listSupplements,
  searchSupplements,
  addSupplement,
  getUserSupplements,
  selectSupplement,
  deselectSupplement,
} = require('../services/supplementService');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /supplements
// Returns the shared supplement catalog: [{ id, name, category, defaultDose, ... }]
router.get('/', async (req, res) => {
  try {
    const supplements = await listSupplements();
    res.json({ supplements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/search?q=creatine
// Search the global catalog by name.
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').toString();
    if (!q.trim()) return res.status(400).json({ error: 'q (query) is required' });
    const results = await searchSupplements(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /supplements/mine  (header: x-user-id)
// Returns the user's selected supplements with nutrition info.
router.get('/mine', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const supplements = await getUserSupplements(userId);
    res.json({ supplements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements/mine  (header: x-user-id)
// Body: { supplementId: string }
// Adds a supplement to the user's selected list.
router.post('/mine', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { supplementId } = req.body || {};
    if (!supplementId) return res.status(400).json({ error: 'supplementId is required' });
    const result = await selectSupplement(userId, supplementId);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /supplements/mine/:supplementId  (header: x-user-id)
// Removes a supplement from the user's selected list.
router.delete('/mine/:supplementId', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    await deselectSupplement(userId, req.params.supplementId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /supplements
// Body: { name, category?, brand?, flavor?, defaultDose?, servingSizeG?, calories?, proteinG?, carbsG?, fatG?, fiberG? }
// Adds a new supplement to the global catalog (idempotent by name).
router.post('/', async (req, res) => {
  try {
    const supplement = await addSupplement(req.body || {});
    res.status(201).json(supplement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
