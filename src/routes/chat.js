const express = require('express');

const router = express.Router();

// POST /chat — stub. Will enforce 5 questions/day limit in a later step.
router.post('/', (req, res) => {
  res.json({ stub: true, route: 'POST /chat', received: req.body ?? null });
});

module.exports = router;
