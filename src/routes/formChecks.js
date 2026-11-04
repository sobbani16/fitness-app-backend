// Exercise form-checks (M16) — trainer requests a technique video, member
// uploads it with explicit consent, trainer leaves timestamped feedback.
// Uploads follow the documents pattern: raw bytes or base64 JSON, private
// docStorage, short-lived signature-checked URLs. Nothing is stored or
// shared without the member's own action.
const express = require('express');
const { requireFeature } = require('../middleware/requireFeature');
const { identifyUser } = require('../middleware/rbac');
const svc = require('../services/formChecks');
const audit = require('../services/auditService');

const router = express.Router();
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });
router.use(requireFeature('trainer_form_feedback_enabled'), identifyUser);

// POST /form-checks — trainer requests a form-check video from a client.
router.post('/', async (req, res) => {
  try {
    const r = await svc.createRequest(req.userId, req.body || {});
    await audit.log({ actorId: req.userId, action: 'form_check.request', entityType: 'FormCheckRequest', entityId: r.id, afterData: { relationId: r.relationId, clientId: r.clientId } });
    res.status(201).json({ request: r });
  } catch (e) { fail(res, e); }
});

router.get('/mine', async (req, res) => {
  try { res.json(await svc.listMine(req.userId, req.query.status)); } catch (e) { fail(res, e); }
});

router.get('/trainer', async (req, res) => {
  try { res.json(await svc.listForTrainer(req.userId, { status: req.query.status, clientId: req.query.clientId })); } catch (e) { fail(res, e); }
});

router.get('/:id', async (req, res) => {
  try { res.json({ request: await svc.getRequest(req.params.id, req.userId) }); } catch (e) { fail(res, e); }
});

// POST /:id/video — member uploads the clip. Raw video bytes
// (?fileName=&consent=true) or JSON {dataBase64, fileName, consentToTrainerReview}.
router.post('/:id/video', express.raw({ type: '*/*', limit: svc.MAX_VIDEO_BYTES + 1024 }), async (req, res) => {
  try {
    let buf, fileName = req.query.fileName, consent = req.query.consent === 'true';
    if (req.is('application/json') || (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))) {
      const parsed = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString('utf8'));
      buf = Buffer.from(parsed.dataBase64 || '', 'base64');
      fileName = fileName || parsed.fileName;
      consent = consent || parsed.consentToTrainerReview === true;
    } else buf = req.body;
    const r = await svc.attachVideo(req.params.id, req.userId, { buf, fileName, consentToTrainerReview: consent });
    await audit.log({ actorId: req.userId, action: 'form_check.upload', entityType: 'FormCheckRequest', entityId: r.id, afterData: { videoBytes: r.videoBytes, consentAt: r.consentAt } });
    res.status(201).json({ request: r });
  } catch (e) { fail(res, e); }
});

router.post('/:id/decline', async (req, res) => {
  try {
    const r = await svc.decline(req.params.id, req.userId);
    await audit.log({ actorId: req.userId, action: 'form_check.decline', entityType: 'FormCheckRequest', entityId: r.id });
    res.json({ request: r });
  } catch (e) { fail(res, e); }
});

// GET /:id/video-url — participant-only signed URL (5 min).
router.get('/:id/video-url', async (req, res) => {
  try { res.json(await svc.videoUrl(req.params.id, req.userId)); } catch (e) { fail(res, e); }
});

// GET /:id/file — signature-checked streaming (signature bound to user).
router.get('/:id/file', async (req, res) => {
  try { await svc.streamVideo(req.params.id, req.userId, req.query.exp, req.query.sig, res); } catch (e) { fail(res, e); }
});

// POST /:id/feedback {timestampSec?, note} — trainer timestamped note.
router.post('/:id/feedback', async (req, res) => {
  try {
    const fb = await svc.addFeedback(req.userId, req.params.id, req.body || {});
    await audit.log({ actorId: req.userId, action: 'form_check.feedback', entityType: 'FormCheckRequest', entityId: req.params.id, afterData: { timestampSec: fb.timestampSec } });
    res.status(201).json({ feedback: fb });
  } catch (e) { fail(res, e); }
});

// POST /:id/acknowledge — member confirms they understood the feedback.
router.post('/:id/acknowledge', async (req, res) => {
  try { res.json(await svc.acknowledge(req.params.id, req.userId)); } catch (e) { fail(res, e); }
});

module.exports = router;
