const express = require('express');
const { generateReply } = require('../services/aiService');
const { createDailyLimiter } = require('../services/rateLimiter');

const router = express.Router();

const DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT || 5);
const limiter = createDailyLimiter({ limit: DAILY_LIMIT });

// Exposed for tests.
router.__limiter = limiter;

function getUserId(req) {
  return (req.headers['x-user-id'] || req.body?.userId || '').toString().trim();
}

// GET /chat/status — remaining quota for today
router.get('/status', (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
  res.json(limiter.status(userId));
});

// POST /chat { message } (header: x-user-id)
router.post('/', (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(400).json({ error: 'x-user-id header or userId required' });
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!message.trim()) return res.status(400).json({ error: 'message is required' });

    const gate = limiter.consume(userId);
    if (!gate.allowed) {
      return res.status(429).json({
        error: 'Daily chat limit reached',
        limit: gate.limit,
        used: gate.used,
        remaining: 0,
      });
    }

    const reply = generateReply(message);
    res.json({
      ...reply,
      quota: { limit: gate.limit, used: gate.used, remaining: gate.remaining },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
