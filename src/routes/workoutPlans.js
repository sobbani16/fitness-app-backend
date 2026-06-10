const express = require('express');
const { requireRole, requirePermission } = require('../middleware/rbac');
const trainerService = require('../services/trainerService');
const audit = require('../services/auditService');

const router = express.Router();

// POST /workout-plans — create a plan (trainer only)
router.post('/', requirePermission('CREATE_WORKOUT_PLAN'), async (req, res) => {
  try {
    const profile = await trainerService.getTrainerByUserId(req.userId);
    if (!profile) return res.status(403).json({ error: 'No trainer profile found.' });
    const { clientId, title, description, exercises } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required.' });
    const plan = await trainerService.createWorkoutPlan(profile.id, clientId, { title, description, exercises });
    await audit.log({
      actorId: req.userId,
      action: 'plan.create',
      entityType: 'WorkoutPlan',
      entityId: plan.id,
      afterData: { clientId, title },
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /workout-plans — list plans (trainer sees own, client sees assigned)
router.get('/', requirePermission('CREATE_WORKOUT_PLAN', 'VIEW_OWN_PROFILE'), async (req, res) => {
  try {
    const profile = await trainerService.getTrainerByUserId(req.userId);
    let plans;
    if (profile) {
      plans = await trainerService.getWorkoutPlans({ trainerId: profile.id });
    } else {
      plans = await trainerService.getWorkoutPlans({ clientId: req.userId });
    }
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /workout-plans/:id
router.get('/:id', requirePermission('CREATE_WORKOUT_PLAN', 'VIEW_OWN_PROFILE'), async (req, res) => {
  try {
    const plan = await trainerService.getWorkoutPlanById(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
