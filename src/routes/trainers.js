const express = require('express');
const { requireRole, requirePermission, identifyUser } = require('../middleware/rbac');
const trainerService = require('../services/trainerService');
const audit = require('../services/auditService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Public — trainer discovery
// ---------------------------------------------------------------------------

// GET /trainers — verified trainers list (filterable by ?tier=standard|pro|elite)
router.get('/', async (req, res) => {
  try {
    const tier = req.query.tier || undefined;
    const trainers = await trainerService.listTrainers({ verified: true, tier });
    res.json({ trainers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trainers/drop-reasons — fetch reason codes for drop forms
router.get('/drop-reasons', async (req, res) => {
  try {
    const reasons = await trainerService.getDropFormReasons();
    res.json(reasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trainer signup & profile management
// ---------------------------------------------------------------------------

// POST /trainers/signup — create trainer profile (pending verification)
router.post('/signup', identifyUser, async (req, res) => {
  try {
    const profile = await trainerService.createTrainerProfile(req.userId, req.body || {});
    await audit.log({
      actorId: req.userId,
      action: 'trainer.signup',
      entityType: 'TrainerProfile',
      entityId: profile.id,
      afterData: { tier: profile.tier, verified: false },
    });
    res.status(201).json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /trainers/me/profile — trainer updates own profile
router.patch('/me/profile', requireRole('TRAINER'), async (req, res) => {
  try {
    const profile = await trainerService.updateTrainerProfile(req.userId, req.body || {});
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trainer — client management
// ---------------------------------------------------------------------------

// GET /trainers/me/clients — trainer's assigned clients
router.get('/me/clients', requireRole('TRAINER'), async (req, res) => {
  try {
    const profile = await trainerService.getTrainerByUserId(req.userId);
    if (!profile) return res.status(404).json({ error: 'Trainer profile not found.' });
    const clients = await trainerService.getTrainerClients(profile.id);
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /trainers/clients/:clientId/progress — client progress dashboard (trainer view)
router.get('/clients/:clientId/progress', requireRole('TRAINER'), async (req, res) => {
  try {
    const { period, from } = req.query;
    const progress = await trainerService.getClientProgress(req.userId, req.params.clientId, { period, from });
    res.json(progress);
  } catch (err) {
    res.status(err.message.includes('not assigned') ? 403 : 500).json({ error: err.message });
  }
});

// POST /trainers/clients/:clientId/drop — trainer drops a client (requires form)
router.post('/clients/:clientId/drop', requireRole('TRAINER'), async (req, res) => {
  try {
    const { reasons, notes, candidateGoals, adherenceRating } = req.body || {};
    const result = await trainerService.trainerDropClient(req.userId, req.params.clientId, {
      reasons,
      notes,
      candidateGoals,
      adherenceRating,
    });
    await audit.log({
      actorId: req.userId,
      action: 'client.dropped_by_trainer',
      entityType: 'TrainerClient',
      entityId: result.relation.id,
      afterData: { clientId: req.params.clientId, reasons },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /trainers/clients/:clientId/status — update client status
router.patch('/clients/:clientId/status', requireRole('TRAINER'), async (req, res) => {
  try {
    const profile = await trainerService.getTrainerByUserId(req.userId);
    if (!profile) return res.status(404).json({ error: 'Trainer profile not found.' });
    const { status } = req.body || {};
    const result = await trainerService.updateClientStatus(profile.id, req.params.clientId, status);
    await audit.log({
      actorId: req.userId,
      action: 'client.status_update',
      entityType: 'TrainerClient',
      entityId: result.id,
      afterData: { status },
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /trainers/clients/assign — admin/system assign (keeps existing behaviour)
router.post('/clients/assign', requirePermission('ASSIGN_CLIENTS', 'MANAGE_TRAINERS'), async (req, res) => {
  try {
    const { trainerId, clientId } = req.body || {};
    if (!trainerId || !clientId) {
      return res.status(400).json({ error: 'trainerId and clientId required.' });
    }
    const result = await trainerService.assignClient(trainerId, clientId);
    await audit.log({
      actorId: req.userId,
      action: 'client.assign',
      entityType: 'TrainerClient',
      entityId: result.id,
      afterData: { trainerId, clientId, status: result.status },
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// User (client) — trainer subscription
// ---------------------------------------------------------------------------

// GET /trainers/me/assigned — current trainer for the logged-in user
router.get('/me/assigned', identifyUser, async (req, res) => {
  try {
    const assigned = await trainerService.getAssignedTrainer(req.userId);
    res.json({ assigned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /trainers/:id/subscribe — user picks a trainer
router.post('/:id/subscribe', identifyUser, async (req, res) => {
  try {
    const result = await trainerService.subscribeToTrainer(req.params.id, req.userId);
    await audit.log({
      actorId: req.userId,
      action: 'trainer.subscribed',
      entityType: 'TrainerClient',
      entityId: result.id,
      afterData: { trainerId: req.params.id },
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'TRAINER_LOCKED') {
      return res.status(423).json({
        error: 'You are locked to your current trainer until the start of next month.',
        lockedUntil: err.lockedUntil,
        daysRemaining: err.daysRemaining,
        currentTrainerId: err.currentTrainerId,
      });
    }
    res.status(400).json({ error: err.message });
  }
});

// POST /trainers/me/drop — client drops their trainer (requires survey)
router.post('/me/drop', identifyUser, async (req, res) => {
  try {
    const { reasons, notes, trainerRating } = req.body || {};
    const result = await trainerService.clientDropTrainer(req.userId, { reasons, notes, trainerRating });
    await audit.log({
      actorId: req.userId,
      action: 'trainer.dropped_by_client',
      entityType: 'TrainerClient',
      entityId: result.relation.id,
      afterData: { reasons, trainerRating },
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'TRAINER_LOCKED') {
      return res.status(423).json({
        error: 'You cannot drop your trainer until the start of next month.',
        lockedUntil: err.lockedUntil,
        daysRemaining: err.daysRemaining,
      });
    }
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trainer detail (public)
// ---------------------------------------------------------------------------

// GET /trainers/:id — trainer profile detail
router.get('/:id', async (req, res) => {
  try {
    const trainer = await trainerService.getTrainerById(req.params.id);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found.' });
    res.json(trainer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
