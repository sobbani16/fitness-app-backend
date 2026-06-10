const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const nutritionistService = require('../services/nutritionistService');
const audit = require('../services/auditService');

const router = express.Router();

// POST /meal-plans — create (nutritionist only)
router.post('/', requirePermission('ASSIGN_MEAL_PLAN'), async (req, res) => {
  try {
    const profile = await nutritionistService.getNutritionistByUserId(req.userId);
    if (!profile) return res.status(403).json({ error: 'No nutritionist profile found.' });
    const { clientId, title, caloriesTarget, proteinTarget, carbsTarget, fatTarget, items } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required.' });
    const plan = await nutritionistService.createMealPlan(profile.id, clientId, {
      title, caloriesTarget, proteinTarget, carbsTarget, fatTarget, items,
    });
    await audit.log({
      actorId: req.userId,
      action: 'plan.create',
      entityType: 'MealPlan',
      entityId: plan.id,
      afterData: { clientId, title, caloriesTarget },
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /meal-plans
router.get('/', requirePermission('ASSIGN_MEAL_PLAN', 'VIEW_OWN_PROFILE'), async (req, res) => {
  try {
    const profile = await nutritionistService.getNutritionistByUserId(req.userId);
    let plans;
    if (profile) {
      plans = await nutritionistService.getMealPlans({ nutritionistId: profile.id });
    } else {
      plans = await nutritionistService.getMealPlans({ clientId: req.userId });
    }
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /meal-plans/:id
router.get('/:id', requirePermission('ASSIGN_MEAL_PLAN', 'VIEW_OWN_PROFILE'), async (req, res) => {
  try {
    const plan = await nutritionistService.getMealPlanById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
