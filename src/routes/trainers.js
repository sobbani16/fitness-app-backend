const express = require('express');
const { requireRole, requirePermission, identifyUser } = require('../middleware/rbac');
const trainerService = require('../services/trainerService');
const audit = require('../services/auditService');

const router = express.Router();

// GET /trainers — public list of verified trainers
router.get('/', async (req, res) => {
  try {
    const tier = req.query.tier || undefined;
    const trainers = await trainerService.listTrainers({ verified: true, tier });
    res.json({ trainers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// POST /trainers/clients/assign — assign a client to a trainer
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

// GET /trainers/:id — trainer profile detail
router.get('/:id', async (req, res) => {
  try {
    const { getPrisma } = require('../lib/prisma');
    const trainer = await getPrisma().trainerProfile.findUnique({ where: { id: req.params.id } });
    if (!trainer) return res.status(404).json({ error: 'Trainer not found.' });
    res.json(trainer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
