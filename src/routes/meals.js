const express = require('express');

const router = express.Router();

// POST /meals — stub for photo-based meal logging.
router.post('/', (req, res) => {
  res.json({ stub: true, route: 'POST /meals', received: req.body ?? null });
});

module.exports = router;
