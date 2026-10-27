const express = require('express');
const { search } = require('../services/youtubeService');
const router = express.Router();

const SORTS = ['recommended', 'most-viewed', 'newest', 'relevance'];

// GET /videos/search?q=bench+press&context=exercise&sort=recommended&pageToken=
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    if (q.length > 200) return res.status(400).json({ error: 'q too long' });
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'recommended';
    const context = ['exercise', 'recipe', 'nutrition', 'education', 'general'].includes(req.query.context) ? req.query.context : 'general';
    const result = await search({ query: q, context, sort, pageToken: req.query.pageToken || undefined });
    res.json(result);
  } catch (err) {
    res.status(err.status === 400 ? 400 : 503).json({ error: err.quota ? 'Video search is temporarily unavailable (quota). Try again later.' : err.message });
  }
});

module.exports = router;
