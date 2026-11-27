// Camera-coaching sessions — consent-gated analytics only, never frames.
const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { identifyUser } = require('../middleware/rbac');
const svc = require('../services/poseCoaching');
const { isPoseDiagnosticsTester } = require('../services/testerAccess');
const audit = require('../services/auditService');

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });
router.use(requireFeature('pose_detection'), identifyUser);

// POST /sessions — persist a consent-approved coaching session.
router.post('/sessions', async (req, res) => {
  try {
    const r = await svc.createSession(req.userId, req.body || {});
    if (!r.stored) return res.status(204).end();
    await audit.log({
      actorId: req.userId,
      action: 'pose_coaching.session_created',
      entityType: 'CoachingSession',
      entityId: r.session.id,
      afterData: { exerciseId: r.session.exerciseId, countedReps: r.session.countedReps },
    });
    res.status(201).json({ session: r.session });
  } catch (e) { fail(res, e); }
});

// GET /progress — §28 version-aware progress summary. Provenance is never
// collapsed; cross-version trend claims are refused when measurement changed.
router.get('/progress', async (req, res) => {
  try {
    res.json(await svc.progressSummary(req.userId, { exerciseId: req.query.exerciseId }));
  } catch (e) { fail(res, e); }
});

router.get('/sessions', async (req, res) => {
  try {
    res.json(await svc.listSessions(req.userId, {
      exerciseId: req.query.exerciseId,
      limit: req.query.limit,
      cursor: req.query.cursor,
    }));
  } catch (e) { fail(res, e); }
});

router.get('/sessions/:id', async (req, res) => {
  try { res.json({ session: await svc.getSession(req.userId, req.params.id) }); } catch (e) { fail(res, e); }
});

// PATCH /sessions/:id — finalize with user-confirmed reps or discard.
router.patch('/sessions/:id', async (req, res) => {
  try {
    const s = await svc.finalizeSession(req.userId, req.params.id, req.body || {});
    await audit.log({
      actorId: req.userId,
      action: 'pose_coaching.session_finalized',
      entityType: 'CoachingSession',
      entityId: s.id,
      afterData: { confirmedReps: s.confirmedReps, discarded: s.discarded },
    });
    res.json({ session: s });
  } catch (e) { fail(res, e); }
});

// DELETE /sessions/:id — owner-only consent withdrawal (hard delete).
router.delete('/sessions/:id', async (req, res) => {
  try {
    await svc.deleteSession(req.userId, req.params.id);
    await audit.log({
      actorId: req.userId,
      action: 'pose_coaching.session_deleted',
      entityType: 'CoachingSession',
      entityId: req.params.id,
    });
    res.json({ deleted: true });
  } catch (e) { fail(res, e); }
});

// GET /diagnostics-access — server-side tester allowlist verdict.
router.get('/diagnostics-access', async (req, res) => {
  try {
    res.json({ allowed: await isPoseDiagnosticsTester(req.userId) });
  } catch (e) { fail(res, e); }
});

module.exports = router;
