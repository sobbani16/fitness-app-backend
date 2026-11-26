// HUM-110 §20/§32 — model registry HTTP surface.
// Reads are authenticated-user scoped (the mobile runtime consumes the
// manifest); every write is ADMIN-only — model promotion is a release action.
const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { requireRole, getUserId } = require('../middleware/rbac');
const registry = require('../services/pose/modelRegistry');

const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// GET /pose-models/manifest — active model per exercise, runtime contract
router.get('/manifest', async (req, res) => {
  try { res.json({ manifest: await registry.activeManifest(getPrisma()) }); }
  catch (err) { fail(res, err); }
});

// POST /pose-models — register a new model artifact (admin)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  try {
    const model = await registry.registerModel(getPrisma(), req.body || {});
    res.status(201).json({ model });
  } catch (err) { fail(res, err); }
});

// POST /pose-models/:id/transition {to, reason, baselineComparison} — admin
router.post('/:id/transition', requireRole('ADMIN'), async (req, res) => {
  try {
    const b = req.body || {};
    const model = await registry.transition(getPrisma(), req.params.id, b.to, {
      actor: getUserId(req), reason: b.reason || '', baselineComparison: b.baselineComparison || null,
    });
    res.json({ model });
  } catch (err) { fail(res, err); }
});

// POST /pose-models/:id/rollback {reason} — admin
router.post('/:id/rollback', requireRole('ADMIN'), async (req, res) => {
  try {
    const model = await registry.rollback(getPrisma(), req.params.id, {
      actor: getUserId(req), reason: (req.body || {}).reason || '',
    });
    res.json({ model });
  } catch (err) { fail(res, err); }
});

// PATCH /pose-models/:id/exercises/:exercise {enabled} — per-capability kill switch (admin)
router.patch('/:id/exercises/:exercise', requireRole('ADMIN'), async (req, res) => {
  try {
    const model = await registry.setExerciseEnabled(
      getPrisma(), req.params.id, req.params.exercise,
      !!(req.body || {}).enabled, { actor: getUserId(req) },
    );
    res.json({ model });
  } catch (err) { fail(res, err); }
});

module.exports = router;
