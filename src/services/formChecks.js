// Exercise form-checks v1 — trainer requests a technique video, the member
// uploads one explicitly consenting to share it, the trainer leaves
// timestamped feedback. Video bytes go to private docStorage and are served
// only through short-lived signature-checked URLs. Nothing is recorded or
// shared without the member's action; declining is always allowed.
const crypto = require('node:crypto');
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const docStorage = require('../lib/docStorage');
const { requireApprovedTrainer, requireRelationParticipant } = require('./trainerAccess');

const MAX_VIDEO_BYTES = Number(process.env.FORM_CHECK_MAX_BYTES || 150 * 1024 * 1024);
const URL_SECRET = process.env.FORM_CHECK_URL_SECRET || process.env.AUTH_LINK_SECRET || 'dev-formcheck-secret';
const URL_TTL_MS = 5 * 60_000;

const safeName = n => String(n || 'form-check.mp4').replace(/[^\w.\-]/g, '_').slice(-120);

// mp4/mov/m4v/3gp carry an 'ftyp' box at offset 4; webm/mkv are EBML.
function looksLikeVideo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') return true;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

const strip = r => (r ? { ...r, videoKey: undefined } : r);

async function requireTrainerRelation(trainerUserId, relationId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const relation = await getPrisma().trainerClient.findUnique({ where: { id: relationId } });
  if (!relation || relation.trainerId !== trainer.id) throw httpError(403, 'Not your client.');
  if (relation.status !== 'active') throw httpError(409, 'Coaching relationship is not active.');
  return { trainer, relation };
}

async function getOwnedRequest(id, userId) {
  const req = await getPrisma().formCheckRequest.findUnique({
    where: { id },
    include: { relation: { include: { trainer: { select: { userId: true, displayName: true } } } }, feedback: { orderBy: { createdAt: 'asc' } } },
  });
  if (!req) throw httpError(404, 'Form check not found.');
  if (req.clientId !== userId && req.relation.trainer.userId !== userId) throw httpError(403, 'Not a participant of this relationship.');
  return req;
}

// Trainer asks the member to film an exercise.
async function createRequest(trainerUserId, { relationId, exerciseKey, exerciseName, note } = {}) {
  if (typeof relationId !== 'string' || !relationId) throw httpError(400, 'relationId required');
  const { relation } = await requireTrainerRelation(trainerUserId, relationId);
  const name = exerciseName?.trim().slice(0, 160) || null;
  const key = exerciseKey?.trim().slice(0, 120) || null;
  if (!name && !key) throw httpError(400, 'exerciseName or exerciseKey required.');
  return getPrisma().formCheckRequest.create({
    data: {
      relationId, trainerId: relation.trainerId, clientId: relation.clientId,
      exerciseKey: key, exerciseName: name, note: note?.trim().slice(0, 1000) || null,
    },
  });
}

async function listMine(userId, status) {
  const rows = await getPrisma().formCheckRequest.findMany({
    where: { clientId: userId, ...(status ? { status: String(status) } : {}) },
    orderBy: { createdAt: 'desc' }, take: 50,
    include: { feedback: { orderBy: { createdAt: 'asc' } } },
  });
  return { requests: rows.map(strip) };
}

async function listForTrainer(trainerUserId, { status, clientId } = {}) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const rows = await getPrisma().formCheckRequest.findMany({
    where: { trainerId: trainer.id, ...(status ? { status: String(status) } : {}), ...(clientId ? { clientId: String(clientId) } : {}) },
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { feedback: { orderBy: { createdAt: 'asc' } } },
  });
  return { requests: rows.map(strip) };
}

async function getRequest(id, userId) {
  const req = await getOwnedRequest(id, userId);
  return strip(req);
}

// Member uploads the video. `consentToTrainerReview` must be explicitly true —
// footage is never stored without it. Re-uploading replaces the prior object.
async function attachVideo(id, userId, { buf, fileName, consentToTrainerReview } = {}, storage = docStorage) {
  const req = await getOwnedRequest(id, userId);
  if (req.clientId !== userId) throw httpError(403, 'Only the member may upload the video.');
  if (!['requested', 'submitted'].includes(req.status)) throw httpError(409, `Cannot upload while status is ${req.status}.`);
  if (consentToTrainerReview !== true) throw httpError(400, 'consentToTrainerReview=true is required — the video is only stored when you choose to share it with your coach.');
  if (!Buffer.isBuffer(buf) || !buf.length) throw httpError(400, 'Video body required.');
  if (buf.length > MAX_VIDEO_BYTES) throw httpError(413, `Video exceeds ${MAX_VIDEO_BYTES} bytes.`);
  if (!looksLikeVideo(buf)) throw httpError(415, 'Only video files are accepted (mp4, mov, webm).');
  const name = safeName(fileName);
  const videoKey = `form-checks/${req.id}/${crypto.randomUUID()}-${name}`;
  const prevKey = req.videoKey;
  await storage.put(videoKey, buf, 'video/mp4');
  const saved = await getPrisma().formCheckRequest.update({
    where: { id: req.id },
    data: {
      videoKey, videoName: name, videoMime: name.endsWith('.webm') ? 'video/webm' : 'video/mp4',
      videoBytes: buf.length, status: 'submitted',
      consentAt: req.consentAt || new Date(), submittedAt: new Date(),
    },
  });
  if (prevKey && prevKey !== videoKey) await storage.remove(prevKey);
  return strip(saved);
}

// Member declines — always allowed, keeps the record honest.
async function decline(id, userId) {
  const req = await getOwnedRequest(id, userId);
  if (req.clientId !== userId) throw httpError(403, 'Only the member may decline.');
  if (req.status !== 'requested') throw httpError(409, `Cannot decline while status is ${req.status}.`);
  return getPrisma().formCheckRequest.update({ where: { id }, data: { status: 'declined' } });
}

// Signed access URL (5 min) — same pattern as trainer documents. Participant only.
async function videoUrl(id, userId) {
  const req = await getOwnedRequest(id, userId);
  if (!req.videoKey || req.status === 'declined') throw httpError(404, 'No video uploaded yet.');
  const exp = Date.now() + URL_TTL_MS;
  const sig = crypto.createHmac('sha256', URL_SECRET).update(`${req.id}:${exp}:${userId}`).digest('hex');
  return {
    url: `/form-checks/${req.id}/file?exp=${exp}&sig=${sig}&filename=${encodeURIComponent(req.videoName || 'form-check.mp4')}`,
    expiresInSec: 300, mimeType: req.videoMime, fileName: req.videoName,
  };
}

// Signature check + stream for /file. Signature is bound to the current user.
async function streamVideo(id, userId, exp, sig, res) {
  const req = await getPrisma().formCheckRequest.findUnique({ where: { id } });
  const expiry = Number(exp);
  if (!req?.videoKey || !Number.isFinite(expiry) || expiry < Date.now()) throw httpError(404, 'Not found.');
  const good = crypto.createHmac('sha256', URL_SECRET).update(`${req.id}:${expiry}:${userId}`).digest('hex');
  if (String(sig || '').length !== good.length || !crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(good))) throw httpError(403, 'Invalid or expired link.');
  res.setHeader('content-type', req.videoMime || 'video/mp4');
  res.setHeader('x-content-type-options', 'nosniff');
  if (!(await docStorage.pipe(req.videoKey, res))) throw httpError(404, 'Not found.');
}

// Trainer leaves timestamped feedback — one row per note, status → reviewed.
async function addFeedback(trainerUserId, id, { timestampSec, note } = {}) {
  const req = await getOwnedRequest(id, trainerUserId);
  if (req.relation.trainer.userId !== trainerUserId) throw httpError(403, 'Only the coach may leave feedback.');
  if (req.status !== 'submitted' && req.status !== 'reviewed') throw httpError(409, 'No submitted video to review yet.');
  const text = String(note || '').trim();
  if (!text || text.length > 1000) throw httpError(400, 'note is required (≤1000 chars).');
  let ts = null;
  if (timestampSec != null) {
    ts = Number(timestampSec);
    if (!Number.isFinite(ts) || ts < 0 || ts > 4 * 3600) throw httpError(400, 'timestampSec must be 0–14400.');
  }
  const prisma = getPrisma();
  const fb = await prisma.formCheckFeedback.create({ data: { requestId: req.id, authorId: trainerUserId, timestampSec: ts, note: text } });
  if (req.status === 'submitted') {
    await prisma.formCheckRequest.update({ where: { id: req.id }, data: { status: 'reviewed', reviewedAt: new Date() } });
  }
  return fb;
}

// Member confirms they understood the feedback.
async function acknowledge(id, userId) {
  const req = await getOwnedRequest(id, userId);
  if (req.clientId !== userId) throw httpError(403, 'Only the member may acknowledge.');
  if (req.status !== 'reviewed') throw httpError(409, 'Feedback is not ready to acknowledge yet.');
  if (req.memberAckAt) return { ok: true, memberAckAt: req.memberAckAt };
  const saved = await getPrisma().formCheckRequest.update({ where: { id }, data: { memberAckAt: new Date() } });
  return { ok: true, memberAckAt: saved.memberAckAt };
}

module.exports = {
  MAX_VIDEO_BYTES, looksLikeVideo,
  createRequest, listMine, listForTrainer, getRequest,
  attachVideo, decline, videoUrl, streamVideo, addFeedback, acknowledge,
};
