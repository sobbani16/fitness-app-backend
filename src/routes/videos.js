const express = require('express');
const { search } = require('../services/youtubeService');
const { getPrisma } = require('../lib/prisma');
const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

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

// POST /videos/report { videoId, reason } — user flags misleading/irrelevant
// results; stored as a privacy-safe event, not as a credibility claim.
router.post('/report', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const { videoId, reason } = req.body || {};
    if (!videoId || typeof videoId !== 'string' || videoId.length > 32) return res.status(400).json({ error: 'videoId required' });
    await getPrisma().userEvent.create({ data: { userId, eventType: 'video.report', eventData: { videoId, reason: String(reason || '').slice(0, 200) } } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
