const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/auditService');

const router = express.Router();

// GET /audit-logs — super admin only
router.get('/', requirePermission('VIEW_AUDIT_LOGS'), async (req, res) => {
  try {
    const { actorId, entityType, limit, offset } = req.query;
    const logs = await audit.query({
      actorId,
      entityType,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
