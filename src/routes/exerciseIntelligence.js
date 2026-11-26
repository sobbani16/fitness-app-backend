// Exercise intelligence read APIs — spec §27 (pc-HUM-108).
// Server-controlled catalog: NO mutation endpoints exist at any layer for
// ordinary users — the spec's "prevent ordinary users from modifying
// profiles or activating unapproved models" is satisfied by construction.
const express = require('express');
const { identifyUser, requireRole } = require('../middleware/rbac');
const svc = require('../services/exerciseIntelligenceService');

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });
router.use(identifyUser);

// Compact full-catalog export — sized for the offline profile cache contract
// (spec §26: offline client access to required profiles).
router.get('/profiles', async (req, res) => {
  try {
    res.json({ profiles: await svc.listProfiles({ exerciseId: req.query.exerciseId }) });
  } catch (e) { fail(res, e); }
});

router.get('/profiles/:exerciseId', async (req, res) => {
  try { res.json({ profile: await svc.getProfile(req.params.exerciseId) }); } catch (e) { fail(res, e); }
});

router.get('/movement-families', async (_req, res) => {
  res.json({ families: svc.listMovementFamilies() });
});

router.get('/model-metadata', async (_req, res) => {
  res.json(svc.getModelMetadata());
});

// Coverage reporting is admin-only: it enumerates classification gaps across
// the full catalog — operational metadata ordinary users do not need.
router.get('/admin/coverage', requireRole('ADMIN'), async (req, res) => {
  try { res.json(await svc.coverageReport()); } catch (e) { fail(res, e); }
});

module.exports = router;
