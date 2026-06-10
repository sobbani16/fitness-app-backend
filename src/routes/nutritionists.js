const express = require('express');
const { requireRole, requirePermission } = require('../middleware/rbac');
const nutritionistService = require('../services/nutritionistService');
const audit = require('../services/auditService');

const router = express.Router();

// GET /nutritionists — public list
router.get('/', async (req, res) => {
  try {
    const list = await nutritionistService.listNutritionists({ verified: true });
    res.json({ nutritionists: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /nutritionists/me/clients
router.get('/me/clients', requireRole('NUTRITIONIST'), async (req, res) => {
  try {
    const profile = await nutritionistService.getNutritionistByUserId(req.userId);
    if (!profile) return res.status(404).json({ error: 'Nutritionist profile not found.' });
    const clients = await nutritionistService.getClients(profile.id);
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /nutritionists/clients/assign
router.post('/clients/assign', requirePermission('ASSIGN_MEAL_PLAN', 'MANAGE_NUTRITIONISTS'), async (req, res) => {
  try {
    const { nutritionistId, clientId } = req.body || {};
    if (!nutritionistId || !clientId) {
      return res.status(400).json({ error: 'nutritionistId and clientId required.' });
    }
    const result = await nutritionistService.assignClient(nutritionistId, clientId);
    await audit.log({
      actorId: req.userId,
      action: 'client.assign',
      entityType: 'NutritionistClient',
      entityId: result.id,
      afterData: { nutritionistId, clientId },
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
