const express = require('express');
const { listSupplements, addSupplement } = require('../services/supplementService');

const router = express.Router();

// GET /supplements
// Returns the shared supplement catalog: [{ id, name, category, defaultDose, isDefault }]
router.get('/', async (req, res) => {
  try {
    const supplements = await listSupplements();
    res.json({ supplements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /supplements
// Body: { name: string, category?: string, defaultDose?: string }
// Adds a new supplement to the catalog (idempotent by name).
router.post('/', async (req, res) => {
  try {
    const { name, category, defaultDose } = req.body || {};
    const supplement = await addSupplement({ name, category, defaultDose });
    res.status(201).json(supplement);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
