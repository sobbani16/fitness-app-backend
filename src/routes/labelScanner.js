const express = require('express');
const {
  extractNutritionFromText,
  adjustPortion,
  saveScannedLabel,
  getUserLabels,
} = require('../services/labelScannerService');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// POST /label-scanner/extract
// Body: { ocrText: string }
// Extracts nutrition data from raw OCR text using AI or regex fallback.
router.post('/extract', async (req, res) => {
  try {
    const { ocrText } = req.body || {};
    if (!ocrText) return res.status(400).json({ error: 'ocrText is required' });

    const extracted = await extractNutritionFromText(ocrText);
    res.json({ extracted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /label-scanner/adjust
// Body: { servingSizeG, actualPortionG, calories, proteinG, carbsG, fatG, fiberG, sugarG }
// Returns portion-adjusted nutrition values (stateless calculation).
router.post('/adjust', (req, res) => {
  try {
    const { servingSizeG, actualPortionG, calories, proteinG, carbsG, fatG, fiberG, sugarG } = req.body || {};
    if (!servingSizeG || !actualPortionG) {
      return res.status(400).json({ error: 'servingSizeG and actualPortionG are required' });
    }

    const adjusted = adjustPortion(
      {
        calories: Number(calories) || 0,
        proteinG: Number(proteinG) || 0,
        carbsG: Number(carbsG) || 0,
        fatG: Number(fatG) || 0,
        fiberG: Number(fiberG) || 0,
        sugarG: Number(sugarG) || 0,
      },
      Number(servingSizeG),
      Number(actualPortionG),
    );

    res.json({ adjusted });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /label-scanner/save
// Body: full label data + actual portion → saves ScannedLabel + creates FoodLog
// Headers: x-user-id
router.post('/save', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const {
      productName,
      ingredients,
      servingSizeG,
      servingsPerContainer,
      labelCalories,
      labelProteinG,
      labelCarbsG,
      labelFatG,
      labelFiberG,
      labelSugarG,
      labelSodiumMg,
      actualPortionG,
      mealType,
      photoUri,
      ocrRawText,
      aiConfidence,
    } = req.body || {};

    if (!servingSizeG || !actualPortionG) {
      return res.status(400).json({ error: 'servingSizeG and actualPortionG are required' });
    }

    const result = await saveScannedLabel(userId, {
      productName,
      ingredients,
      servingSizeG: Number(servingSizeG),
      servingsPerContainer: servingsPerContainer ? Number(servingsPerContainer) : null,
      labelCalories: Number(labelCalories) || 0,
      labelProteinG: Number(labelProteinG) || 0,
      labelCarbsG: Number(labelCarbsG) || 0,
      labelFatG: Number(labelFatG) || 0,
      labelFiberG: Number(labelFiberG) || 0,
      labelSugarG: Number(labelSugarG) || 0,
      labelSodiumMg: Number(labelSodiumMg) || 0,
      actualPortionG: Number(actualPortionG),
      mealType,
      photoUri,
      ocrRawText,
      aiConfidence: aiConfidence ? Number(aiConfidence) : null,
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /label-scanner/history
// Headers: x-user-id
router.get('/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header required' });

    const limit = Number(req.query.limit) || 20;
    const labels = await getUserLabels(userId, limit);
    res.json({ labels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
