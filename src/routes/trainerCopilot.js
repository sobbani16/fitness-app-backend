// Trainer Copilot (M15) — read-only client summaries + rule-based draft
// suggestions. There are intentionally no write endpoints: drafts are
// generated on read and applied only through the normal plan/check-in
// flows after trainer confirmation.
const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { identifyUser } = require('../middleware/rbac');
const copilot = require('../services/trainerCopilot');
const audit = require('../services/auditService');

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });
router.use(requireFeature('trainer_copilot_enabled'), identifyUser);

// GET /trainer/copilot/clients — status line per active client.
router.get('/clients', async (req, res) => {
  try { res.json(await copilot.listClients(req.userId)); } catch (e) { fail(res, e); }
});

// GET /trainer/copilot/clients/:clientId/summary — consent-scoped summary.
router.get('/clients/:clientId/summary', async (req, res) => {
  try {
    const r = await copilot.clientSummary(req.userId, req.params.clientId);
    await audit.log({ actorId: req.userId, action: 'copilot.view_summary', entityType: 'TrainerClient', entityId: r.relation.id, afterData: { clientId: req.params.clientId } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

// GET /trainer/copilot/clients/:clientId/suggestions — rule-based drafts,
// each labeled "AI draft — requires trainer confirmation".
router.get('/clients/:clientId/suggestions', async (req, res) => {
  try {
    const r = await copilot.clientSuggestions(req.userId, req.params.clientId);
    await audit.log({ actorId: req.userId, action: 'copilot.view_suggestions', entityType: 'TrainerClient', entityId: r.relationId, afterData: { clientId: req.params.clientId, count: r.suggestions.length } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

module.exports = router;
