// Trainer nutrition guidance — trainer-side plan management.
// Mounted at /trainer/nutrition-plans (see src/routes/index.js mount lines).
// Every route: requireFeature -> requireRole('TRAINER') -> service-level
// approved-trainer + active-relation + consent checks.
const express = require('express');
const { requireRole } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const service = require('../services/trainerNutritionService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
router.use(requireFeature('trainer_nutrition_guidance_enabled'), requireRole('TRAINER'));

// POST /trainer/nutrition-plans — create a draft plan
router.post('/', async (req, res, next) => {
  try {
    const plan = await coachingTransaction(async (tx) => {
      const plan = await service.createDraft(req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.create',
        entityType: 'TrainerNutritionPlan',
        entityId: plan.id,
        afterData: { clientId: plan.clientId, status: plan.status, version: plan.version },
      }, tx);
      return plan;
    });
    res.status(201).json({ ...plan, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// GET /trainer/nutrition-plans/clients/:clientId/progress — trainer progress view
// (declared before /:id so 'clients' is never captured as a plan id)
router.get('/clients/:clientId/progress', async (req, res, next) => {
  try {
    res.json(await service.getClientProgress(req.userId, req.params.clientId));
  } catch (err) { next(err); }
});

// GET /trainer/nutrition-plans — trainer's plans (?status=draft|published|archived)
router.get('/', async (req, res, next) => {
  try {
    res.json(await service.listTrainerPlans(req.userId, { status: req.query.status }));
  } catch (err) { next(err); }
});

// GET /trainer/nutrition-plans/:id — plan detail with computed nutrition
router.get('/:id', async (req, res, next) => {
  try {
    res.json(await service.getTrainerPlan(req.userId, req.params.id));
  } catch (err) { next(err); }
});

// GET /trainer/nutrition-plans/:id/preview — nutrition totals + allergy warnings
router.get('/:id/preview', async (req, res, next) => {
  try {
    res.json(await service.previewPlan(req.userId, req.params.id));
  } catch (err) { next(err); }
});

// PATCH /trainer/nutrition-plans/:id — edit a draft (children fully replaced)
router.patch('/:id', async (req, res, next) => {
  try {
    const plan = await coachingTransaction(async (tx) => {
      const plan = await service.updateDraft(req.userId, req.params.id, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.update',
        entityType: 'TrainerNutritionPlan',
        entityId: plan.id,
        afterData: { clientId: plan.clientId, status: plan.status, version: plan.version },
      }, tx);
      return plan;
    });
    res.json({ ...plan, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /trainer/nutrition-plans/:id/publish
router.post('/:id/publish', async (req, res, next) => {
  try {
    const plan = await coachingTransaction(async (tx) => {
      const plan = await service.publishPlan(req.userId, req.params.id, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.publish',
        entityType: 'TrainerNutritionPlan',
        entityId: plan.id,
        afterData: { status: plan.status, version: plan.version },
      }, tx);
      return plan;
    });
    res.json({ ...plan, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /trainer/nutrition-plans/:id/revise — new draft version, supersedes prior
router.post('/:id/revise', async (req, res, next) => {
  try {
    const plan = await coachingTransaction(async (tx) => {
      const plan = await service.revisePlan(req.userId, req.params.id, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.revise',
        entityType: 'TrainerNutritionPlan',
        entityId: plan.id,
        afterData: { status: plan.status, version: plan.version },
      }, tx);
      return plan;
    });
    res.status(201).json({ ...plan, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /trainer/nutrition-plans/:id/archive
router.post('/:id/archive', async (req, res, next) => {
  try {
    const plan = await coachingTransaction(async (tx) => {
      const plan = await service.archivePlan(req.userId, req.params.id, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.archive',
        entityType: 'TrainerNutritionPlan',
        entityId: plan.id,
        afterData: { status: plan.status, version: plan.version },
      }, tx);
      return plan;
    });
    res.json({ ...plan, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /trainer/nutrition-plans/:id/assign — { clientId } -> assignment + allergy warnings
router.post('/:id/assign', async (req, res, next) => {
  try {
    const { clientId } = req.body || {};
    if (typeof clientId !== 'string' || !clientId.trim()) {
      return res.status(400).json({ error: 'clientId required.' });
    }
    const result = await coachingTransaction(async (tx) => {
      const result = await service.assignPlan(req.userId, req.params.id, clientId.trim(), tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.assign',
        entityType: 'TrainerNutritionAssignment',
        entityId: result.assignment.id,
        afterData: { clientId, status: result.assignment.status },
      }, tx);
      return result;
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
