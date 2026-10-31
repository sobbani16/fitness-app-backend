// Client-side nutrition plan endpoints — mounted at /me/nutrition-plans.
// The client's own assignments: respond, feedback, and logging a suggested
// meal into their OWN FoodLog (the only FoodLog write path in this feature).
const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const service = require('../services/trainerNutritionService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
router.use(requireFeature('trainer_nutrition_guidance_enabled'), identifyUser);

// GET /me/nutrition-plans — my assignments
router.get('/', async (req, res, next) => {
  try {
    res.json(await service.listClientAssignments(req.userId));
  } catch (err) { next(err); }
});

// GET /me/nutrition-plans/:assignmentId — assigned plan detail w/ nutrition + allergy warnings
router.get('/:assignmentId', async (req, res, next) => {
  try {
    res.json(await service.getClientAssignment(req.userId, req.params.assignmentId));
  } catch (err) { next(err); }
});

// POST /me/nutrition-plans/:assignmentId/respond — { action: 'accept' | 'decline' }
router.post('/:assignmentId/respond', async (req, res, next) => {
  try {
    const { action } = req.body || {};
    const assignment = await coachingTransaction(async (tx) => {
      const assignment = await service.respondToAssignment(req.userId, req.params.assignmentId, action, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.assignment_respond',
        entityType: 'TrainerNutritionAssignment',
        entityId: assignment.id,
        afterData: { status: assignment.status },
      }, tx);
      return assignment;
    });
    res.json({ assignment, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /me/nutrition-plans/:assignmentId/feedback — { rating?, note? }
router.post('/:assignmentId/feedback', async (req, res, next) => {
  try {
    const { rating, note } = req.body || {};
    const feedback = await coachingTransaction(async (tx) => {
      const feedback = await service.addFeedback(req.userId, req.params.assignmentId, { rating, note }, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.feedback',
        entityType: 'TrainerNutritionAssignment',
        entityId: req.params.assignmentId,
        afterData: { rating: feedback.rating },
      }, tx);
      return feedback;
    });
    res.status(201).json({ feedback, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

// POST /me/nutrition-plans/:assignmentId/log — { mealId, loggedAt?, items? }
// Creates the CLIENT's own FoodLog rows (source 'trainer_plan'). Never touches
// another user's logs, goals, or any trainer-owned data.
router.post('/:assignmentId/log', async (req, res, next) => {
  try {
    const { mealId, loggedAt, items } = req.body || {};
    if (typeof mealId !== 'string' || !mealId.trim()) {
      return res.status(400).json({ error: 'mealId required.' });
    }
    const logs = await coachingTransaction(async (tx) => {
      const logs = await service.logAssignmentMeal(req.userId, req.params.assignmentId, { mealId, loggedAt, items }, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.meal_logged',
        entityType: 'TrainerNutritionAssignment',
        entityId: req.params.assignmentId,
        afterData: { status: 'logged' },
      }, tx);
      return logs;
    });
    res.status(201).json({ logs, disclaimer: service.DISCLAIMER });
  } catch (err) { next(err); }
});

module.exports = router;
