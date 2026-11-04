// Coaching loop routes — intake (M12), shared outcome plans (M13),
// partnership preference (M17). Each sub-router is flag-gated;
// per-resource authorization (active relation, participant, trainer-owner)
// is enforced in the services.
const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { identifyUser } = require('../middleware/rbac');
const intake = require('../services/coachingIntake');
const plans = require('../services/outcomePlans');
const partnership = require('../services/partnership');
const audit = require('../services/auditService');

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// =========================================================================
// INTAKE — progressive baseline assessment, versioned
// =========================================================================
const intakeRouter = express.Router();
intakeRouter.use(requireFeature('coaching_intake_enabled'), identifyUser);

intakeRouter.get('/:relationId', async (req, res) => {
  try { res.json(await intake.getIntake(req.params.relationId, req.userId)); } catch (e) { fail(res, e); }
});

// PUT /:relationId — progressive patch (any subset of sections). Edits to a
// frozen version automatically open the next version.
intakeRouter.put('/:relationId', async (req, res) => {
  try {
    const r = await intake.patchIntake(req.params.relationId, req.userId, req.body || {});
    await audit.log({ actorId: req.userId, action: 'intake.update', entityType: 'BaselineAssessment', entityId: r.assessment.id, afterData: { relationId: req.params.relationId, version: r.assessment.version } });
    res.status(r.created ? 201 : 200).json(r);
  } catch (e) { fail(res, e); }
});

intakeRouter.post('/:relationId/submit', async (req, res) => {
  try {
    const r = await intake.submitIntake(req.params.relationId, req.userId);
    if (!r.alreadySubmitted) await audit.log({ actorId: req.userId, action: 'intake.submit', entityType: 'BaselineAssessment', entityId: r.assessment.id, afterData: { relationId: req.params.relationId, version: r.assessment.version } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

intakeRouter.post('/:relationId/review', async (req, res) => {
  try {
    const r = await intake.reviewIntake(req.params.relationId, req.userId);
    if (!r.alreadyReviewed) await audit.log({ actorId: req.userId, action: 'intake.review', entityType: 'BaselineAssessment', entityId: r.assessment.id, afterData: { relationId: req.params.relationId, version: r.assessment.version } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

// =========================================================================
// OUTCOME PLANS — shared goals, versioned adjustments
// =========================================================================
const plansRouter = express.Router();
plansRouter.use(requireFeature('shared_outcome_plans_enabled'), identifyUser);

plansRouter.post('/', async (req, res) => {
  try {
    const plan = await plans.createPlan(req.userId, req.body || {});
    await audit.log({ actorId: req.userId, action: 'outcome_plan.create', entityType: 'OutcomePlan', entityId: plan.id, afterData: { relationId: plan.relationId } });
    res.status(201).json({ plan });
  } catch (e) { fail(res, e); }
});

plansRouter.get('/mine', async (req, res) => {
  try { res.json(await plans.listMine(req.userId)); } catch (e) { fail(res, e); }
});

plansRouter.get('/trainer', async (req, res) => {
  try { res.json(await plans.listForTrainer(req.userId, req.query.clientId)); } catch (e) { fail(res, e); }
});

plansRouter.get('/relation/:relationId', async (req, res) => {
  try { res.json(await plans.getActivePlan(req.params.relationId, req.userId)); } catch (e) { fail(res, e); }
});

plansRouter.get('/relation/:relationId/versions', async (req, res) => {
  try { res.json(await plans.listVersions(req.params.relationId, req.userId)); } catch (e) { fail(res, e); }
});

plansRouter.patch('/goals/:goalId', async (req, res) => {
  try { res.json({ goal: await plans.updateGoalStatus(req.userId, req.params.goalId, req.body || {}) }); } catch (e) { fail(res, e); }
});

plansRouter.get('/:id', async (req, res) => {
  try { res.json({ plan: await plans.getPlan(req.params.id, req.userId) }); } catch (e) { fail(res, e); }
});

// PUT /:id — revise: produces the next version + a member-visible adjustment.
plansRouter.put('/:id', async (req, res) => {
  try {
    const plan = await plans.revisePlan(req.userId, req.params.id, req.body || {});
    await audit.log({ actorId: req.userId, action: 'outcome_plan.revise', entityType: 'OutcomePlan', entityId: plan.id, afterData: { relationId: plan.relationId, version: plan.version } });
    res.status(201).json({ plan });
  } catch (e) { fail(res, e); }
});

plansRouter.post('/:id/status', async (req, res) => {
  try {
    const plan = await plans.closePlan(req.userId, req.params.id, req.body?.status);
    await audit.log({ actorId: req.userId, action: `outcome_plan.${plan.status}`, entityType: 'OutcomePlan', entityId: plan.id });
    res.json({ plan });
  } catch (e) { fail(res, e); }
});

// =========================================================================
// PARTNERSHIP PREFERENCE — coaching model + trainer-plan precedence
// =========================================================================
const prefRouter = express.Router();
prefRouter.use(requireFeature('trainer_partnership_enabled'), identifyUser);

prefRouter.get('/', async (req, res) => {
  try { res.json(await partnership.getPreference(req.userId)); } catch (e) { fail(res, e); }
});

prefRouter.put('/', async (req, res) => {
  try {
    const r = await partnership.updatePreference(req.userId, req.body || {});
    await audit.log({ actorId: req.userId, action: 'coaching_preference.update', entityType: 'CoachingPreference', entityId: req.userId, afterData: { model: r.model, planPrecedence: r.planPrecedence } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

router.use('/intake', intakeRouter);
router.use('/outcome-plans', plansRouter);
router.use('/preference', prefRouter);

module.exports = router;
