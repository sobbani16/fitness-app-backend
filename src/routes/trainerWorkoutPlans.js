const express = require('express');
const { requireRole } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const planService = require('../services/trainerPlanService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();

// Advanced trainer platform: flag first (403 FEATURE_DISABLED), TRAINER role
// second. Approved-trainer + relation checks live in trainerPlanService.
router.use(requireFeature('trainer_workout_plans_enabled'));
router.use(requireRole('TRAINER'));

// POST /trainer/workout-plans — create a draft plan (optionally with days[]).
router.post('/', async (req, res) => {
  try {
    const plan = await coachingTransaction(async tx => {
      const plan = await planService.createDraft(req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.create',
        entityType: 'WorkoutPlan',
        entityId: plan.id,
        afterData: { status: 'draft' },
      }, tx);
      return plan;
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /trainer/workout-plans/:id — edit draft scalars and/or replace days[].
router.patch('/:id', async (req, res) => {
  try {
    const plan = await coachingTransaction(async tx => {
      const plan = await planService.updateDraft(req.userId, req.params.id, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.update',
        entityType: 'WorkoutPlan',
        entityId: plan.id,
        afterData: { status: plan.status },
      }, tx);
      return plan;
    });
    res.json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /trainer/workout-plans/:id/publish — draft → published.
router.post('/:id/publish', async (req, res) => {
  try {
    const plan = await coachingTransaction(async tx => {
      const plan = await planService.publish(req.userId, req.params.id, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.publish',
        entityType: 'WorkoutPlan',
        entityId: plan.id,
        afterData: { status: 'published' },
      }, tx);
      return plan;
    });
    res.json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /trainer/workout-plans/:id/revise — clone into version+1 draft, archive old.
router.post('/:id/revise', async (req, res) => {
  try {
    const plan = await coachingTransaction(async tx => {
      const plan = await planService.revise(req.userId, req.params.id, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.revise',
        entityType: 'WorkoutPlan',
        entityId: plan.id,
        afterData: { status: 'draft' },
      }, tx);
      return plan;
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /trainer/workout-plans/:id/assign {clientId} — assign to a client.
router.post('/:id/assign', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    if (typeof clientId !== 'string' || !clientId.trim()) {
      return res.status(400).json({ error: 'clientId required.' });
    }
    const assignment = await coachingTransaction(async tx => {
      const assignment = await planService.assign(req.userId, req.params.id, clientId.trim(), tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.assign',
        entityType: 'TrainerWorkoutAssignment',
        entityId: assignment.id,
        afterData: { clientId: clientId.trim(), status: assignment.status },
      }, tx);
      return assignment;
    });
    res.status(201).json(assignment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /trainer/workout-plans — list own plans (?status=&take=&cursor=).
router.get('/', async (req, res) => {
  try {
    res.json(await planService.listForTrainer(req.userId, req.query));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /trainer/workout-plans/:id/progress — planned-vs-completed per assignment.
router.get('/:id/progress', async (req, res) => {
  try {
    res.json(await planService.progressForPlan(req.userId, req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /trainer/workout-plans/:id — plan detail incl. days/exercises/assignments.
router.get('/:id', async (req, res) => {
  try {
    res.json(await planService.getForTrainer(req.userId, req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
