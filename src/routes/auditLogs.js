const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/auditService');

const router = express.Router();

// GET /audit-logs — requires explicit VIEW_AUDIT_LOGS permission
router.get('/', requirePermission('VIEW_AUDIT_LOGS'), async (req, res) => {
  try {
    const logs = await audit.query(req.query);
    res.set('Cache-Control', 'no-store');
    res.json({ logs });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Audit query failed.' });
  }
});

module.exports = router;
