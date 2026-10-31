const express = require('express');
const { requireRole, requirePermission, identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const trainerService = require('../services/trainerService');
const applications = require('../services/trainerApplications');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
// trainer_dashboard flag gates the entire trainer suite; surface flags below
// (discovery/registration/coaching/insights) apply on top of RBAC checks.
router.use(requireFeature('trainer_dashboard'));

// ---------------------------------------------------------------------------
// Public — trainer discovery
// ---------------------------------------------------------------------------

// GET /trainers — approved+discoverable trainers. Filters:
// ?q= (name/location) &tier= &specialty= &mode=online|in_person|both
// &language= &country= &cursor=<id>&take=<n>
router.get('/', requireFeature('trainer_discovery'), async (req, res) => {
  try {
    const { tier, q, specialty, mode, language, country, cursor, take } = req.query;
    const { trainers, nextCursor } = await trainerService.listTrainers({
      tier, q, specialty, mode, language, country, cursor, take,
    });
    res.json({ trainers, nextCursor });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// POST /trainers/signup — create trainer profile + submit application
router.post('/signup', requireFeature('trainer_registration'), identifyUser, async (req, res) => {
  try {
    const profile = await coachingTransaction(async tx => {
      const profile = await trainerService.createTrainerProfile(req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.signup',
        entityType: 'TrainerProfile',
        entityId: profile.id,
        afterData: { tier: profile.tier, verified: false, applicationStatus: profile.applicationStatus },
      }, tx);
      return profile;
    });
    res.status(201).json(profile);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trainer applications (registration workflow)
// ---------------------------------------------------------------------------

// POST /trainers/applications — save/overwrite a draft application
router.post('/applications', requireFeature('trainer_registration'), identifyUser, async (req, res) => {
  try {
    const profile = await coachingTransaction(async tx => {
      const profile = await applications.saveDraft(req.userId, req.body || {}, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.apply',
        entityType: 'TrainerProfile',
        entityId: profile.id,
        afterData: { applicationStatus: profile.applicationStatus, tier: profile.tier },
      }, tx);
      return profile;
    });
    res.status(201).json(profile);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /trainers/applications/me — own application status + admin note
router.get('/applications/me', requireFeature('trainer_registration'), identifyUser, async (req, res) => {
  try {
    res.json(await applications.getMyApplication(req.userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /trainers/applications/me — edit draft / changes_requested application
router.patch('/applications/me', requireFeature('trainer_registration'), identifyUser, async (req, res) => {
  try {
    res.json(await applications.updateDraft(req.userId, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /trainers/applications/me/submit — validate + submit for review
router.post('/applications/me/submit', requireFeature('trainer_registration'), identifyUser, async (req, res) => {
  try {
    const profile = await coachingTransaction(async tx => {
      const profile = await applications.submitApplication(req.userId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.submit',
        entityType: 'TrainerProfile',
        entityId: profile.id,
        afterData: { applicationStatus: profile.applicationStatus, tier: profile.tier },
      }, tx);
      return profile;
    });
    res.json(profile);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Structured certifications (trainer-owned; verification is admin-only —
// every write forces verificationStatus back to 'unverified')
// ---------------------------------------------------------------------------

router.get('/me/certifications', identifyUser, async (req, res) => {
  try {
    res.json({ certifications: await applications.listCertifications(req.userId) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/me/certifications', identifyUser, async (req, res) => {
  try {
    res.status(201).json(await applications.addCertification(req.userId, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.patch('/me/certifications/:certId', identifyUser, async (req, res) => {
  try {
    res.json(await applications.updateCertification(req.userId, req.params.certId, req.body || {}));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/me/certifications/:certId', identifyUser, async (req, res) => {
  try {
    res.json(await applications.deleteCertification(req.userId, req.params.certId));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /trainers/me/profile — trainer updates own profile
router.patch('/me/profile', requireRole('TRAINER'), async (req, res) => {
  try {
    const profile = await coachingTransaction(async tx => {
      const profile = await trainerService.updateTrainerProfile(req.userId, req.body || {}, tx);
      await audit.log({ actorId: req.userId, action: 'trainer.profile_updated', entityType: 'TrainerProfile', entityId: profile.id, afterData: { userId: req.userId } }, tx);
      return profile;
    });
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

// GET /trainers/clients/:clientId/progress — consent-filtered client progress (trainer view)
router.get('/clients/:clientId/progress', requireFeature('trainer_insights'), requireRole('TRAINER'), async (req, res) => {
  try {
    const { period, from } = req.query;
    const progress = await trainerService.getClientProgress(req.userId, req.params.clientId, { period, from });
    res.json(progress);
  } catch (err) {
    res.status(err.status || (err.message.includes('not assigned') ? 403 : 500)).json({ error: err.message });
  }
});

// POST /trainers/clients/:clientId/drop — trainer drops a client (requires form)
router.post('/clients/:clientId/drop', requireRole('TRAINER'), async (req, res) => {
  try {
    const { reasons, notes, candidateGoals, adherenceRating } = req.body || {};
    const result = await coachingTransaction(async tx => {
      const result = await trainerService.trainerDropClient(req.userId, req.params.clientId, {
        reasons,
        notes,
        candidateGoals,
        adherenceRating,
      }, tx);
      await audit.log({
        actorId: req.userId,
        action: 'client.dropped_by_trainer',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { clientId: req.params.clientId, status: 'dropped' },
      }, tx);
      return result;
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
    const result = await coachingTransaction(async tx => {
      const result = await trainerService.updateClientStatus(profile.id, req.params.clientId, status, tx);
      await audit.log({
        actorId: req.userId,
        action: 'client.status_update',
        entityType: 'TrainerClient',
        entityId: result.id,
        afterData: { status },
      }, tx);
      return result;
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /trainers/clients/assign — admin/system assign (keeps existing behaviour)
router.post('/clients/assign', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try {
    const { trainerId, clientId } = req.body || {};
    if (!trainerId || !clientId) {
      return res.status(400).json({ error: 'trainerId and clientId required.' });
    }
    const result = await coachingTransaction(async tx => {
      const result = await trainerService.assignClient(trainerId, clientId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'client.assign',
        entityType: 'TrainerClient',
        entityId: result.id,
        afterData: { trainerId, clientId, status: result.status },
      }, tx);
      return result;
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

// POST /trainers/:id/subscribe — client requests a trainer (pending until accepted)
router.post('/:id/subscribe', requireFeature('trainer_coaching'), identifyUser, async (req, res) => {
  try {
    const result = await coachingTransaction(async tx => {
      const previous = await tx.trainerClient.findFirst({ where: { clientId: req.userId, status: 'active' } });
      const result = await trainerService.subscribeToTrainer(req.params.id, req.userId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.subscribed',
        entityType: 'TrainerClient',
        entityId: result.id,
        beforeData: previous ? { trainerId: previous.trainerId, status: previous.status } : {},
        afterData: { trainerId: req.params.id, clientId: req.userId, status: result.status },
      }, tx);
      return result;
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
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /trainers/me/drop — client drops their trainer (requires survey)
router.post('/me/drop', identifyUser, async (req, res) => {
  try {
    const { reasons, notes, trainerRating } = req.body || {};
    const result = await coachingTransaction(async tx => {
      const result = await trainerService.clientDropTrainer(req.userId, { reasons, notes, trainerRating }, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.dropped_by_client',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { clientId: req.userId, status: 'dropped' },
      }, tx);
      return result;
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
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Trainer detail (public)
// ---------------------------------------------------------------------------

// GET /trainers/:id — public trainer profile detail (approved + discoverable only)
router.get('/:id', requireFeature('trainer_discovery'), async (req, res) => {
  try {
    const trainer = await trainerService.getTrainerById(req.params.id);
    if (!trainer) return res.status(404).json({ error: 'Trainer not found.' });
    res.json(trainer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
