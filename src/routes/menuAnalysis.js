const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { analyzeMenu } = require('../services/menuAnalysis');

function getUserId(req) {
  return (req.headers['x-user-id'] || req.body?.userId || '').toString().trim();
}

// POST /menu-analysis — structured menu extraction + nutrition + personalization.
// Body: { ocrTexts?: string[], images?: dataURL[], restaurantName?, preferences? }
router.post('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { ocrTexts, images, restaurantName, preferences } = req.body || {};
    if (!ocrTexts?.length && !images?.length)
      return res.status(400).json({ error: 'Provide ocrTexts and/or images' });
    res.json(await analyzeMenu({ prisma: getPrisma(), userId, ocrTexts, images, restaurantName, preferences }));
  } catch (e) { next(e); }
});

module.exports = router;
