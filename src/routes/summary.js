const express = require('express');

const router = express.Router();

// GET /summary/daily — stub for end-of-day AI summary.
router.get('/daily', (req, res) => {
  res.json({ stub: true, route: 'GET /summary/daily' });
});

module.exports = router;
