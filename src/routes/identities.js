// Linked external identities — additive management surface. Gated by
// external_identity_linking_enabled (default OFF). Until the OIDC flow ships,
// subject/issuer are caller-supplied and only used for linking; they can never
// create sessions, change auth behavior, or resolve another user's data.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { requireFeature } = require('../middleware/requireFeature');
const { linkIdentity, listIdentities, unlinkIdentity } = require('../services/identity');

const router = express.Router();
router.use(authenticate, requireFeature('external_identity_linking_enabled'));

router.get('/', async (req, res, next) => {
  try { res.json({ identities: await listIdentities(req.userId) }); } catch (e) { next(e); }
});

router.post('/link', async (req, res, next) => {
  try {
    const { issuer, subject, provider } = req.body || {};
    const r = await linkIdentity(req.userId, { issuer, subject, provider });
    res.status(r.linked ? 201 : 200).json({ identity: { id: r.identity.id, provider: r.identity.provider, issuer: r.identity.issuer, subject: r.identity.subject, createdAt: r.identity.createdAt }, linked: r.linked });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try { res.json(await unlinkIdentity(req.userId, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
