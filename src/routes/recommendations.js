const express = require('express');

const router = express.Router();

// GET /recommendations — stub for rule-based workout/diet recommendations.
router.get('/', (req, res) => {
  res.json({ stub: true, route: 'GET /recommendations' });
});

module.exports = router;
