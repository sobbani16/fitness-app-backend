// HUM-100 P3: consent-gated pose recording — HTTP surface.
// All routes owner-scoped: participants manage their own consent and clips.
const express = require('express');
const router = express.Router();
const { getPrisma } = require('../lib/prisma');
const { getUserId } = require('../middleware/rbac');
const platform = require('../services/pose/recordingPlatform');

const errRes = (res, err) => res.status(err.status || 500).json({ error: err.message });

// POST /pose/consent — grant recording consent (scope items validated)
router.post('/consent', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const row = await platform.grantConsent(getPrisma(), userId, req.body || {});
    res.status(201).json({ consentId: row.id, participantKey: row.participantKey, scopeItems: row.scopeItems, consentVersion: row.consentVersion });
  } catch (err) { errRes(res, err); }
});

// GET /pose/consent — current consent state
router.get('/consent', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const row = await getPrisma().poseConsent.findFirst({ where: { userId, revokedAt: null }, orderBy: { signedAt: 'desc' } });
    res.json({ active: !!row, consent: row ? { consentId: row.id, scopeItems: row.scopeItems, signedAt: row.signedAt } : null });
  } catch (err) { errRes(res, err); }
});

// DELETE /pose/consent — revoke + cascade-delete all clips (atomic)
router.delete('/consent', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const r = await platform.revokeConsent(getPrisma(), userId, { channel: 'in_app' });
    res.json({ revoked: true, clipsDeleted: r.clipsDeleted });
  } catch (err) { errRes(res, err); }
});

// POST /pose/clips — consent+license-gated clip registration
router.post('/clips', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const clip = await platform.ingestClip(getPrisma(), userId, req.body || {});
    res.status(201).json({ clipId: clip.id, status: clip.status, participantKey: clip.participantKey });
  } catch (err) { errRes(res, err); }
});

// GET /pose/clips — own clips, metadata only (never storage refs cross-user)
router.get('/clips', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const consents = await getPrisma().poseConsent.findMany({ where: { userId }, select: { id: true } });
    const clips = await getPrisma().poseClip.findMany({
      where: { consentId: { in: consents.map((c) => c.id) }, status: { not: 'deleted' } },
      select: { id: true, exerciseId: true, durationMs: true, viewpoint: true, landmarkOnly: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ clips });
  } catch (err) { errRes(res, err); }
});

// DELETE /pose/clips/:id — delete own clip
router.delete('/clips/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'unauthorized' });
    const prisma = getPrisma();
    const clip = await prisma.poseClip.findUnique({ where: { id: req.params.id }, include: { consent: { select: { userId: true } } } });
    if (!clip || clip.consent.userId !== userId) return res.status(404).json({ error: 'not_found' });
    await prisma.poseClip.update({ where: { id: clip.id }, data: { status: 'deleted', deletedAt: new Date() } });
    res.json({ deleted: true });
  } catch (err) { errRes(res, err); }
});

module.exports = router;
