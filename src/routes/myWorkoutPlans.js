const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const planService = require('../services/trainerPlanService');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();

// Client side of trainer workout plans. Same flag as the trainer router;
// identifyUser only attaches identity — assignment ownership is enforced
// inside the service (clients never see each other's rows).
router.use(requireFeature('trainer_workout_plans_enabled'));
router.use(identifyUser);

// GET /me/workout-plans — my assignments with plan summaries (?take=&cursor=).
router.get('/', async (req, res) => {
  try {
    res.json(await planService.listForClient(req.userId, req.query));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /me/workout-plans/:assignmentId — full plan + days/exercises + my feedback/sessions.
router.get('/:assignmentId', async (req, res) => {
  try {
    res.json(await planService.getForClient(req.params.assignmentId, req.userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /me/workout-plans/:assignmentId/respond {action: 'accept'|'decline'}
router.post('/:assignmentId/respond', async (req, res) => {
  try {
    const assignment = await coachingTransaction(async tx => {
      const assignment = await planService.respondToAssignment(
        req.params.assignmentId, req.userId, (req.body || {}).action, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.assignment_respond',
        entityType: 'TrainerWorkoutAssignment',
        entityId: assignment.id,
        afterData: { status: assignment.status },
      }, tx);
      return assignment;
    });
    res.json(assignment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /me/workout-plans/:assignmentId/feedback {rating?, note?, workoutSessionId?}
router.post('/:assignmentId/feedback', async (req, res) => {
  try {
    const feedback = await coachingTransaction(async tx => {
      const feedback = await planService.addFeedback(req.params.assignmentId, req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.feedback',
        entityType: 'TrainerWorkoutAssignment',
        entityId: req.params.assignmentId,
      }, tx);
      return feedback;
    });
    res.status(201).json(feedback);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /me/workout-plans/:assignmentId/complete {workoutSessionId}
// Links the logged session to the assignment (WorkoutSession.planAssignmentId)
// after verifying the session belongs to the caller, then marks it completed.
router.post('/:assignmentId/complete', async (req, res) => {
  try {
    const assignment = await coachingTransaction(async tx => {
      const assignment = await planService.completeAssignment(
        req.params.assignmentId, req.userId, (req.body || {}).workoutSessionId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'plan.assignment_complete',
        entityType: 'TrainerWorkoutAssignment',
        entityId: assignment.id,
        afterData: { status: assignment.status },
      }, tx);
      return assignment;
    });
    res.json(assignment);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
