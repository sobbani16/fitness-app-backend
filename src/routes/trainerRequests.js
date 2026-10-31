// Trainer request + relationship router. Mounted at BOTH:
//   /trainer-requests       (pending request listing, accept/decline, invite)
//   /trainer-relationships  (consents, end)
// Every path works under either mount; clients and trainers share the surface.
const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const relations = require('../services/trainerRelations');
const audit = require('../services/auditService');
const { coachingTransaction } = require('../services/coachingTransaction');

const router = express.Router();
// trainer_coaching gates the whole surface (dependsOn trainer_dashboard).
router.use(requireFeature('trainer_coaching'), identifyUser);

// GET / — trainer sees incoming pending requests; ?mine=1 → client's own.
router.get('/', async (req, res) => {
  try {
    const requests = req.query.mine === '1'
      ? await relations.listPendingRequestsForClient(req.userId)
      : await relations.listPendingRequestsForTrainer(req.userId);
    res.json({ requests });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /invite {clientId} — trainer-initiated request (client accepts).
router.post('/invite', async (req, res) => {
  try {
    const { clientId } = req.body || {};
    const result = await coachingTransaction(async tx => {
      const result = await relations.inviteClient(req.userId, clientId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.invite',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { clientId, status: result.relation.status },
      }, tx);
      return result;
    });
    res.status(201).json(result.relation);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /:id/accept — the non-requesting party confirms → relation active.
router.post('/:id/accept', async (req, res) => {
  try {
    const result = await coachingTransaction(async tx => {
      const result = await relations.acceptRequest(req.params.id, req.userId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.request_accept',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { relationId: result.relation.id, status: result.relation.status },
      }, tx);
      return result;
    });
    res.json(result.relation);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /:id/decline — non-requester declines (or requester cancels) → dropped.
router.post('/:id/decline', async (req, res) => {
  try {
    const result = await coachingTransaction(async tx => {
      const result = await relations.declineRequest(req.params.id, req.userId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.request_decline',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { relationId: result.relation.id, status: result.relation.status },
      }, tx);
      return result;
    });
    res.json(result.relation);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /:id/consents — all consent categories + statuses (either participant).
router.get('/:id/consents', async (req, res) => {
  try {
    res.json(await relations.getConsents(req.params.id, req.userId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /:id/consents {grants:[], revokes:[]} — client only; revoke is immediate.
router.put('/:id/consents', async (req, res) => {
  try {
    const { grants, revokes } = req.body || {};
    const result = await coachingTransaction(async tx => {
      const result = await relations.updateConsents(req.params.id, req.userId, { grants, revokes }, tx);
      for (const category of grants || []) {
        await audit.log({
          actorId: req.userId,
          action: 'consent.grant',
          entityType: 'TrainerClientConsent',
          entityId: req.params.id,
          afterData: { relationId: req.params.id, category, status: 'granted' },
        }, tx);
      }
      for (const category of revokes || []) {
        await audit.log({
          actorId: req.userId,
          action: 'consent.revoke',
          entityType: 'TrainerClientConsent',
          entityId: req.params.id,
          afterData: { relationId: req.params.id, category, status: 'revoked' },
        }, tx);
      }
      return result;
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /:id/end — either participant ends the relationship; consents revoked.
router.post('/:id/end', async (req, res) => {
  try {
    const result = await coachingTransaction(async tx => {
      const result = await relations.endRelationship(req.params.id, req.userId, tx);
      await audit.log({
        actorId: req.userId,
        action: 'trainer.relationship_end',
        entityType: 'TrainerClient',
        entityId: result.relation.id,
        afterData: { relationId: result.relation.id, status: result.relation.status },
      }, tx);
      return result;
    });
    res.json(result.relation);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
