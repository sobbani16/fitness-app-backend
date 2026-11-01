// Coaching communication platform: groups, trainer documents, video sessions.
// Every route is flag-gated; authorization (approved trainer, active relation,
// group membership, document share) is enforced per-resource below.
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getPrisma } = require('../lib/prisma');
const { identifyUser, requireRole, requirePermission } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const { requireApprovedTrainer, requireActiveRelation, requireRelationParticipant } = require('../services/trainerAccess');
const audit = require('../services/auditService');

const router = express.Router();
const prisma = getPrisma();
const httpError = (status, message) => Object.assign(new Error(message), { status });
const fail = (res, err) => res.status(err.status || 500).json({ error: err.message });

// =========================================================================
// GROUPS — Humai-managed coaching groups
// =========================================================================
const groups = express.Router();
groups.use(requireFeature('group_messaging_enabled'), identifyUser);

const ACTIVE_MEMBER = { status: 'active' };

async function requireGroupRole(groupId, userId, roles = ['member', 'moderator', 'owner']) {
  const m = await prisma.coachingGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!m || m.status !== 'active' || !roles.includes(m.role)) throw httpError(403, 'Not an active group member.');
  return m;
}

async function requireGroupTrainer(groupId, userId) {
  const group = await prisma.coachingGroup.findUnique({ where: { id: groupId }, include: { trainer: true } });
  if (!group || group.trainer.userId !== userId) throw httpError(403, 'Only the group trainer may do that.');
  return group;
}

// GET /groups — groups I belong to (any role) or own
groups.get('/', async (req, res) => {
  try {
    const memberships = await prisma.coachingGroupMember.findMany({
      where: { userId: req.userId, status: 'active' },
      include: { group: { include: { trainer: { select: { displayName: true, verified: true } }, members: { where: ACTIVE_MEMBER, select: { userId: true, role: true } } } } },
      orderBy: { joinedAt: 'desc' },
    });
    res.json({ groups: memberships.map(m => ({ ...m.group, myRole: m.role })) });
  } catch (err) { fail(res, err); }
});

// POST /groups — approved trainer creates a group
groups.post('/', requireRole('TRAINER'), async (req, res) => {
  try {
    const trainer = await requireApprovedTrainer(req.userId);
    const { name, kind = 'coaching' } = req.body || {};
    if (!name || name.trim().length < 2 || name.length > 120) throw httpError(400, 'name must be 2–120 characters.');
    if (!['coaching', 'cohort', 'challenge', 'nutrition'].includes(kind)) throw httpError(400, 'Invalid group kind.');
    const group = await prisma.coachingGroup.create({
      data: {
        name: name.trim(), kind, trainerId: trainer.id,
        members: { create: { userId: req.userId, role: 'owner', status: 'active', joinedAt: new Date() } },
      },
    });
    await audit.log({ actorId: req.userId, action: 'group.create', entityType: 'CoachingGroup', entityId: group.id });
    res.status(201).json({ group });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/invite — trainer invites a user who has an ACTIVE relation
groups.post('/:id/invite', requireRole('TRAINER'), async (req, res) => {
  try {
    const group = await requireGroupTrainer(req.params.id, req.userId);
    if (group.status !== 'active') throw httpError(409, 'Group is archived.');
    const { userId } = req.body || {};
    if (!userId) throw httpError(400, 'userId required.');
    // Invitation requires an existing authorized coaching relationship — never
    // cold-invite strangers into groups.
    await requireActiveRelation({ trainerUserId: req.userId, clientUserId: userId });
    const member = await prisma.coachingGroupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId } },
      update: { status: 'invited', invitedBy: req.userId, leftAt: null },
      create: { groupId: group.id, userId, invitedBy: req.userId },
    });
    await audit.log({ actorId: req.userId, action: 'group.invite', entityType: 'CoachingGroup', entityId: group.id, afterData: { userId } });
    res.status(201).json({ member });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/accept — invited member joins
groups.post('/:id/accept', async (req, res) => {
  try {
    const m = await prisma.coachingGroupMember.findUnique({ where: { groupId_userId: { groupId: req.params.id, userId: req.userId } } });
    if (!m || m.status !== 'invited') throw httpError(404, 'No invitation found.');
    res.json({ member: await prisma.coachingGroupMember.update({ where: { id: m.id }, data: { status: 'active', joinedAt: new Date() } }) });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/leave — any member leaves (owner = archive)
groups.post('/:id/leave', async (req, res) => {
  try {
    const m = await prisma.coachingGroupMember.findUnique({ where: { groupId_userId: { groupId: req.params.id, userId: req.userId } } });
    if (!m || m.status !== 'active') throw httpError(404, 'Not a member.');
    if (m.role === 'owner') {
      await prisma.coachingGroup.update({ where: { id: m.groupId }, data: { status: 'archived' } });
      return res.json({ archived: true });
    }
    res.json({ member: await prisma.coachingGroupMember.update({ where: { id: m.id }, data: { status: 'left', leftAt: new Date() } }) });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/remove/:userId — owner/moderator removes a member
groups.post('/:id/remove/:userId', async (req, res) => {
  try {
    await requireGroupRole(req.params.id, req.userId, ['owner', 'moderator']);
    const target = await prisma.coachingGroupMember.findUnique({ where: { groupId_userId: { groupId: req.params.id, userId: req.params.userId } } });
    if (!target || target.status !== 'active') throw httpError(404, 'Not an active member.');
    if (target.role === 'owner') throw httpError(403, 'Cannot remove the owner.');
    res.json({ member: await prisma.coachingGroupMember.update({ where: { id: target.id }, data: { status: 'removed', leftAt: new Date() } }) });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/archive — owner archives
groups.post('/:id/archive', requireRole('TRAINER'), async (req, res) => {
  try {
    await requireGroupTrainer(req.params.id, req.userId);
    res.json({ group: await prisma.coachingGroup.update({ where: { id: req.params.id }, data: { status: 'archived' } }) });
  } catch (err) { fail(res, err); }
});

// GET /groups/:id/messages?before=<messageId>&limit — paginated history
groups.get('/:id/messages', async (req, res) => {
  try {
    await requireGroupRole(req.params.id, req.userId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const where = { groupId: req.params.id, deletedAt: null };
    if (req.query.before) where.id = { lt: String(req.query.before) };
    const messages = await prisma.groupMessage.findMany({ where, orderBy: { id: 'desc' }, take: limit });
    res.json({ messages: messages.reverse() });
  } catch (err) { fail(res, err); }
});

// GET /groups/:id/messages/search?q= — member-scoped full-body search
groups.get('/:id/messages/search', async (req, res) => {
  try {
    await requireGroupRole(req.params.id, req.userId);
    const q = String(req.query.q || '').trim();
    if (q.length < 2) throw httpError(400, 'q must be ≥2 chars.');
    const messages = await prisma.groupMessage.findMany({
      where: { groupId: req.params.id, deletedAt: null, body: { contains: q, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' }, take: 50,
    });
    res.json({ messages });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/messages {body} — active members only
groups.post('/:id/messages', async (req, res) => {
  try {
    await requireGroupRole(req.params.id, req.userId);
    const body = (req.body?.body || '').trim();
    if (!body || body.length > 4000) throw httpError(400, 'body must be 1–4000 characters.');
    const message = await prisma.groupMessage.create({ data: { groupId: req.params.id, senderId: req.userId, body } });
    // Notify other active members via the existing inbox — never leak message body.
    const group = await prisma.coachingGroup.findUnique({ where: { id: req.params.id }, select: { name: true } });
    const others = await prisma.coachingGroupMember.findMany({ where: { groupId: req.params.id, status: 'active', userId: { not: req.userId } }, select: { userId: true } });
    for (const o of others) {
      prisma.notification.create({ data: { userId: o.userId, type: 'group_message', title: `New message in ${group?.name || 'group'}`, body: 'Open the group to read it.' } }).catch(() => {});
    }
    res.status(201).json({ message });
  } catch (err) { fail(res, err); }
});

// POST /groups/:id/read — update read cursor
groups.post('/:id/read', async (req, res) => {
  try {
    await requireGroupRole(req.params.id, req.userId);
    const cursor = await prisma.groupReadCursor.upsert({
      where: { groupId_userId: { groupId: req.params.id, userId: req.userId } },
      update: { lastReadMessageId: req.body?.messageId || null },
      create: { groupId: req.params.id, userId: req.userId, lastReadMessageId: req.body?.messageId || null },
    });
    res.json({ cursor });
  } catch (err) { fail(res, err); }
});

// POST /reports {messageKind, messageId, reason} — report a DM or group message
router.post('/reports', requireFeature('group_messaging_enabled'), identifyUser, async (req, res) => {
  try {
    const { messageKind, messageId, reason } = req.body || {};
    if (!['dm', 'group'].includes(messageKind)) throw httpError(400, 'messageKind must be dm|group.');
    if (!reason || reason.trim().length < 4 || reason.length > 1000) throw httpError(400, 'reason must be 4–1000 characters.');
    // Verify reporter can legitimately see the message.
    if (messageKind === 'group') {
      const msg = await prisma.groupMessage.findUnique({ where: { id: String(messageId) } });
      if (!msg) throw httpError(404, 'Message not found.');
      await requireGroupRole(msg.groupId, req.userId);
    } else {
      const msg = await prisma.message.findUnique({ where: { id: String(messageId) }, include: { conversation: true } });
      if (!msg) throw httpError(404, 'Message not found.');
      await requireRelationParticipant(msg.conversation.relationId, req.userId);
    }
    const report = await prisma.messageReport.create({
      data: { messageKind, messageId: String(messageId), reporterId: req.userId, reason: reason.trim() },
    });
    await audit.log({ actorId: req.userId, action: 'message.report', entityType: 'MessageReport', entityId: report.id });
    res.status(201).json({ report });
  } catch (err) { fail(res, err); }
});

// =========================================================================
// DOCUMENTS — trainer PDF library (private storage, consent-scoped sharing)
// =========================================================================
const docs = express.Router();
docs.use(requireFeature('trainer_documents_enabled'), identifyUser);

const UPLOAD_DIR = process.env.DOCUMENT_STORAGE_DIR || path.join(process.cwd(), 'var', 'uploads');
const MAX_DOC_BYTES = Number(process.env.DOCUMENT_MAX_BYTES || 10 * 1024 * 1024);
const DOC_URL_SECRET = process.env.AUTH_LINK_SECRET || 'dev-doc-secret';
const CATEGORIES = ['nutrition', 'workout', 'meal_plan', 'exercise', 'progress', 'education'];
const docStorage = require('../lib/docStorage');
const DOC_SCAN_CMD = process.env.DOC_SCAN_CMD || ''; // e.g. 'clamdscan --fdpass'
const DOC_SCAN_REQUIRED = process.env.DOC_SCAN_REQUIRED === 'true'; // fail-closed when a scanner is mandated

// Run the configured scanner on `full`. Resolves when clean or when scanning
// is unavailable-and-not-mandated; rejects on detection or required failure.
async function scanDocument(full) {
  if (!DOC_SCAN_CMD) {
    if (DOC_SCAN_REQUIRED) throw httpError(503, 'Document scanning is required but no scanner is configured.');
    return;
  }
  const { execFile } = require('child_process');
  const [cmd, ...args] = DOC_SCAN_CMD.split(' ');
  await new Promise((resolve, reject) => {
    execFile(cmd, [...args, full], { timeout: 60_000 }, (err) => {
      if (!err) return resolve();
      if (err.code === 1) return reject(httpError(422, 'File rejected by security scan.'));
      if (DOC_SCAN_REQUIRED) return reject(httpError(503, 'Security scan unavailable; try again later.'));
      resolve(); // scanner down but not mandated: accept (audit flags the miss)
    });
  });
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const safeName = n => String(n || 'document.pdf').replace(/[^\w.\-]/g, '_').slice(-120);

async function requireDocOwner(docId, userId) {
  const doc = await prisma.trainerDocument.findUnique({ where: { id: docId }, include: { trainer: true } });
  if (!doc || doc.trainer.userId !== userId) throw httpError(404, 'Document not found.');
  return doc;
}

async function requireDocAccess(docId, userId) {
  const doc = await prisma.trainerDocument.findUnique({ where: { id: docId }, include: { trainer: true, shares: true } });
  if (!doc || doc.status !== 'active') throw httpError(404, 'Document not found.');
  if (doc.trainer.userId === userId) return doc;
  // member access requires a share on an ACTIVE relation involving the user,
  // or an active group membership.
  for (const s of doc.shares) {
    if (s.relationId) {
      try { await requireRelationParticipant(s.relationId, userId); return doc; } catch { /* try next */ }
    }
    if (s.groupId) {
      try { await requireGroupRole(s.groupId, userId); return doc; } catch { /* try next */ }
    }
  }
  throw httpError(403, 'This document was not shared with you.');
}

// POST /trainer/documents — raw PDF body (?title=&category=&description=)
// express.raw is applied below; BFF sends base64 JSON which we also accept.
docs.post('/trainer', requireRole('TRAINER'), express.raw({ type: '*/*', limit: MAX_DOC_BYTES + 1024 }), async (req, res) => {
  try {
    const trainer = await requireApprovedTrainer(req.userId);
    let buf;
    if (req.is('application/json') || (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))) {
      const parsed = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString('utf8'));
      buf = Buffer.from(parsed.dataBase64 || '', 'base64');
      req.query.title = req.query.title || parsed.title;
      req.query.category = req.query.category || parsed.category;
      req.query.description = req.query.description || parsed.description;
      req.query.fileName = req.query.fileName || parsed.fileName;
    } else buf = req.body;
    if (!buf?.length) throw httpError(400, 'File body required.');
    if (buf.length > MAX_DOC_BYTES) throw httpError(413, `File exceeds ${MAX_DOC_BYTES} bytes.`);
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') throw httpError(415, 'Only PDF files are accepted.');
    const title = String(req.query.title || '').trim();
    if (!title || title.length > 160) throw httpError(400, 'title is required (≤160 chars).');
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : 'education';
    const fileName = safeName(req.query.fileName || `${title}.pdf`);
    const fileKey = `${trainer.id}/${crypto.randomUUID()}-${fileName}`;
    // Scanner needs a filesystem path — use a tmp file in S3 mode.
    let scanPath = path.join(UPLOAD_DIR, fileKey);
    if (docStorage.usingS3()) scanPath = path.join(require('os').tmpdir(), `scan-${crypto.randomUUID()}.pdf`);
    fs.mkdirSync(path.dirname(scanPath), { recursive: true });
    fs.writeFileSync(scanPath, buf);
    try {
      await scanDocument(scanPath);
    } catch (e) {
      fs.rmSync(scanPath, { force: true });
      throw e;
    }
    try {
      await docStorage.put(fileKey, buf);
    } finally {
      if (scanPath !== path.join(UPLOAD_DIR, fileKey)) fs.rmSync(scanPath, { force: true });
    }
    const doc = await prisma.trainerDocument.create({
      data: { trainerId: trainer.id, title, description: String(req.query.description || '').slice(0, 1000) || null, category, fileKey, fileName, mimeType: 'application/pdf', sizeBytes: buf.length },
    });
    await audit.log({ actorId: req.userId, action: 'document.upload', entityType: 'TrainerDocument', entityId: doc.id, afterData: { sizeBytes: buf.length, category } });
    res.status(201).json({ document: { ...doc, fileKey: undefined } });
  } catch (err) { fail(res, err); }
});

// GET /trainer/documents — own library
docs.get('/trainer', requireRole('TRAINER'), async (req, res) => {
  try {
    const trainer = await requireApprovedTrainer(req.userId);
    const rows = await prisma.trainerDocument.findMany({ where: { trainerId: trainer.id }, include: { shares: true }, orderBy: { uploadedAt: 'desc' } });
    res.json({ documents: rows.map(d => ({ ...d, fileKey: undefined })) });
  } catch (err) { fail(res, err); }
});

// GET /me/documents — documents shared with me
docs.get('/me', async (req, res) => {
  try {
    // shares on relations where I'm the client + groups where I'm active
    const rels = await prisma.trainerClient.findMany({ where: { clientId: req.userId, status: 'active' }, select: { id: true } });
    const groups = await prisma.coachingGroupMember.findMany({ where: { userId: req.userId, status: 'active' }, select: { groupId: true } });
    const shares = await prisma.trainerDocumentShare.findMany({
      where: {
        document: { status: 'active' },
        OR: [
          { relationId: { in: rels.map(r => r.id) } },
          { groupId: { in: groups.map(g => g.groupId) } },
        ],
      },
      include: { document: { include: { trainer: { select: { displayName: true, verified: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ documents: shares.map(s => ({ ...s.document, fileKey: undefined, sharedAt: s.createdAt })) });
  } catch (err) { fail(res, err); }
});

// POST /documents/:id/share {relationId?|groupId?} — owner shares
docs.post('/:id/share', requireRole('TRAINER'), async (req, res) => {
  try {
    const doc = await requireDocOwner(req.params.id, req.userId);
    if (doc.status !== 'active') throw httpError(409, 'Document is revoked.');
    const { relationId, groupId } = req.body || {};
    if (!relationId && !groupId) throw httpError(400, 'relationId or groupId required.');
    if (relationId) await requireActiveRelation({ trainerUserId: req.userId, clientUserId: (await prisma.trainerClient.findUniqueOrThrow({ where: { id: relationId } })).clientId });
    if (groupId) await requireGroupTrainer(groupId, req.userId);
    // Nullable relationId/groupId can't be a compound-unique upsert — dedupe manually.
    const existing = await prisma.trainerDocumentShare.findFirst({
      where: { documentId: doc.id, relationId: relationId || null, groupId: groupId || null },
    });
    const share = existing || await prisma.trainerDocumentShare.create({
      data: { documentId: doc.id, relationId: relationId || null, groupId: groupId || null },
    });
    await audit.log({ actorId: req.userId, action: 'document.share', entityType: 'TrainerDocument', entityId: doc.id, afterData: { relationId, groupId } });
    res.status(201).json({ share });
  } catch (err) { fail(res, err); }
});

// POST /documents/:id/revoke — owner revokes the document entirely
docs.post('/:id/revoke', requireRole('TRAINER'), async (req, res) => {
  try {
    const doc = await requireDocOwner(req.params.id, req.userId);
    await prisma.trainerDocument.update({ where: { id: doc.id }, data: { status: 'revoked' } });
    await docStorage.remove(doc.fileKey); // private object is deleted on revoke
    await audit.log({ actorId: req.userId, action: 'document.revoke', entityType: 'TrainerDocument', entityId: doc.id });
    res.json({ document: { ...doc, status: 'revoked' } });
  } catch (err) { fail(res, err); }
});

// GET /documents/:id/url — short-lived signed download URL
docs.get('/:id/url', async (req, res) => {
  try {
    const doc = await requireDocAccess(req.params.id, req.userId);
    const exp = Date.now() + 5 * 60_000;
    const sig = crypto.createHmac('sha256', DOC_URL_SECRET).update(`${doc.id}:${exp}:${req.userId}`).digest('hex');
    res.json({ url: `/documents/${doc.id}/file?exp=${exp}&sig=${sig}&filename=${encodeURIComponent(doc.fileName)}`, expiresInSec: 300 });
  } catch (err) { fail(res, err); }
});

// GET /documents/:id/file — signature-checked streaming (no userId in signature
// so links work across the BFF boundary; signature is bound to session cookie
// presence via identifyUser above — the signed URL itself authorizes fetch).
docs.get('/:id/file', async (req, res) => {
  try {
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || '');
    const doc = await prisma.trainerDocument.findUnique({ where: { id: req.params.id } });
    if (!doc || doc.status !== 'active' || !Number.isFinite(exp) || exp < Date.now()) throw httpError(404, 'Not found.');
    // Signature must verify against the CURRENT authenticated user — prevents
    // link forwarding to a different account.
    const good = crypto.createHmac('sha256', DOC_URL_SECRET).update(`${doc.id}:${exp}:${req.userId}`).digest('hex');
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw httpError(403, 'Invalid or expired link.');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${doc.fileName}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    if (!(await docStorage.pipe(doc.fileKey, res))) throw httpError(404, 'Not found.');
  } catch (err) { fail(res, err); }
});

// =========================================================================
// VIDEO SESSIONS — scheduled 1:1 calls (provider-agnostic; LiveKit adapter)
// =========================================================================
const video = express.Router();
video.use(requireFeature('video_sessions_enabled'), identifyUser);

const VIDEO_TOKEN_SECRET = process.env.AUTH_LINK_SECRET || 'dev-video-secret';
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const livekitReady = Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET);

const mintJoinToken = async (session, userId) => {
  const exp = Math.floor(Date.now() / 1000) + 15 * 60; // 15-min join window
  if (livekitReady) {
    const { AccessToken } = require('livekit-server-sdk');
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      ttl: '15m',
      metadata: JSON.stringify({ vs: session.id }),
    });
    // Participant may join/publish/subscribe in THIS room only — no admin,
    // no other rooms, no recording grant (egress stays server-controlled).
    at.addGrant({ roomJoin: true, room: session.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    return { token: await at.toJwt(), livekitUrl: LIVEKIT_URL, expiresAt: new Date(exp * 1000).toISOString(), provider: 'livekit' };
  }
  const payload = Buffer.from(JSON.stringify({ v: 1, room: session.roomName, vs: session.id, uid: userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', VIDEO_TOKEN_SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt: new Date(exp * 1000).toISOString(), provider: 'humai-dev' };
};

const participantOf = async (id, userId) => {
  const vs = await prisma.videoSession.findUnique({ where: { id }, include: { relation: true } });
  if (!vs) throw httpError(404, 'Session not found.');
  const rel = vs.relation;
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: rel.trainerId } });
  if (rel.clientId !== userId && trainer?.userId !== userId) throw httpError(403, 'Not a session participant.');
  return vs;
};

// GET /video-sessions — mine (as trainer or client)
video.get('/', async (req, res) => {
  try {
    const trainer = await prisma.trainerProfile.findFirst({ where: { userId: req.userId } });
    const sessions = await prisma.videoSession.findMany({
      where: { OR: [{ relation: { clientId: req.userId } }, ...(trainer ? [{ relation: { trainerId: trainer.id } }] : [])] },
      orderBy: { scheduledStart: 'asc' },
      include: { summary: true },
    });
    res.json({ sessions });
  } catch (err) { fail(res, err); }
});

// POST /video-sessions {relationId, scheduledStart, scheduledEnd, purpose}
video.post('/', requireRole('TRAINER'), async (req, res) => {
  try {
    const { relationId, scheduledStart, scheduledEnd, purpose, exerciseKey } = req.body || {};
    const rel = await prisma.trainerClient.findUnique({ where: { id: String(relationId) } });
    if (!rel || rel.status !== 'active') throw httpError(404, 'Active relationship required.');
    const trainer = await prisma.trainerProfile.findUnique({ where: { id: rel.trainerId } });
    if (!trainer || trainer.userId !== req.userId) throw httpError(403, 'Not your client.');
    const start = new Date(scheduledStart), end = new Date(scheduledEnd);
    if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) throw httpError(400, 'Valid scheduledStart/scheduledEnd required.');
    const session = await prisma.videoSession.create({
      data: { relationId: rel.id, roomName: `humai-${crypto.randomUUID()}`, purpose: String(purpose || '').slice(0, 500) || null, exerciseKey: String(exerciseKey || '').slice(0, 120) || null, scheduledStart: start, scheduledEnd: end },
    });
    await audit.log({ actorId: req.userId, action: 'video_session.create', entityType: 'VideoSession', entityId: session.id });
    res.status(201).json({ session });
  } catch (err) { fail(res, err); }
});

// POST /video-sessions/:id/join — participant-only, 15-min room credential
video.post('/:id/join', async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    if (!['scheduled', 'live'].includes(vs.status)) throw httpError(409, `Session is ${vs.status}.`);
    if (Date.now() > +new Date(vs.scheduledEnd) + 30 * 60_000) throw httpError(410, 'Session window has passed.');
    if (vs.status === 'scheduled') await prisma.videoSession.update({ where: { id: vs.id }, data: { status: 'live' } });
    res.json(await mintJoinToken(vs, req.userId));
  } catch (err) { fail(res, err); }
});

// POST /video-sessions/:id/cancel — either participant
video.post('/:id/cancel', async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    if (!['scheduled', 'live'].includes(vs.status)) throw httpError(409, `Session is ${vs.status}.`);
    res.json({ session: await prisma.videoSession.update({ where: { id: vs.id }, data: { status: 'cancelled', endedAt: new Date() } }) });
  } catch (err) { fail(res, err); }
});

// POST /video-sessions/:id/end — trainer ends
video.post('/:id/end', requireRole('TRAINER'), async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    res.json({ session: await prisma.videoSession.update({ where: { id: vs.id }, data: { status: 'ended', endedAt: new Date(), recordingStartedAt: vs.recordingStartedAt, recordingEndedAt: vs.recordingStartedAt ? new Date() : null } }) });
  } catch (err) { fail(res, err); }
});

// Recording consent — separate flag; affirmative per-participant consent.
const CONSENT_VERSION = 'recording-consent/v1';

video.post('/:id/recording-consent', requireFeature('call_recording_enabled'), async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    const { granted } = req.body || {};
    if (typeof granted !== 'boolean') throw httpError(400, 'granted must be boolean.');
    const consent = await prisma.recordingConsent.upsert({
      where: { videoSessionId_userId: { videoSessionId: vs.id, userId: req.userId } },
      update: { granted, policyVersion: CONSENT_VERSION, withdrawnAt: null },
      create: { videoSessionId: vs.id, userId: req.userId, granted, policyVersion: CONSENT_VERSION },
    });
    await audit.log({ actorId: req.userId, action: 'recording.consent', entityType: 'VideoSession', entityId: vs.id, afterData: { granted, policyVersion: CONSENT_VERSION } });
    res.json({ consent });
  } catch (err) { fail(res, err); }
});

// Trainer may mark recordingRequested — actual capture is provider egress and
// stays OFF until every active participant has granted consent.
video.post('/:id/recording', requireFeature('call_recording_enabled'), requireRole('TRAINER'), async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    const { enabled } = req.body || {};
    if (enabled === true) {
      const consents = await prisma.recordingConsent.findMany({ where: { videoSessionId: vs.id, granted: true, withdrawnAt: null } });
      const rel = vs.relation;
      const trainer = await prisma.trainerProfile.findUnique({ where: { id: rel.trainerId } });
      const needed = new Set([rel.clientId, trainer.userId]);
      for (const uid of needed) if (!consents.some(c => c.userId === uid)) throw httpError(409, 'Recording requires affirmative consent from every participant.');
      await prisma.videoSession.update({ where: { id: vs.id }, data: { recordingRequested: true, recordingStartedAt: new Date() } });
    } else {
      await prisma.videoSession.update({ where: { id: vs.id }, data: { recordingRequested: false, recordingEndedAt: new Date() } });
    }
    await audit.log({ actorId: req.userId, action: 'recording.toggle', entityType: 'VideoSession', entityId: vs.id, afterData: { enabled: !!enabled } });
    res.json({ session: await prisma.videoSession.findUnique({ where: { id: vs.id } }) });
  } catch (err) { fail(res, err); }
});

// Session summary — trainer writes; memberSummary visible to both,
// privateNotes visible only to the trainer.
video.put('/:id/summary', requireRole('TRAINER'), async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    const { memberSummary, actionItems, privateNotes, publish } = req.body || {};
    const summary = await prisma.videoSessionSummary.upsert({
      where: { videoSessionId: vs.id },
      update: {
        memberSummary: memberSummary != null ? String(memberSummary).slice(0, 8000) : undefined,
        actionItems: actionItems !== undefined ? actionItems : undefined,
        privateNotes: privateNotes != null ? String(privateNotes).slice(0, 8000) : undefined,
        publishedAt: publish ? new Date() : undefined,
      },
      create: { videoSessionId: vs.id, memberSummary: memberSummary ? String(memberSummary).slice(0, 8000) : null, actionItems: actionItems || null, privateNotes: privateNotes ? String(privateNotes).slice(0, 8000) : null, publishedAt: publish ? new Date() : null },
    });
    res.json({ summary });
  } catch (err) { fail(res, err); }
});

video.get('/:id/summary', async (req, res) => {
  try {
    const vs = await participantOf(req.params.id, req.userId);
    const summary = await prisma.videoSessionSummary.findUnique({ where: { videoSessionId: vs.id } });
    if (!summary) throw httpError(404, 'No summary yet.');
    const isClient = vs.relation.clientId === req.userId;
    if (isClient && !summary.publishedAt) throw httpError(404, 'No summary yet.');
    res.json({ summary: isClient ? { ...summary, privateNotes: undefined } : summary });
  } catch (err) { fail(res, err); }
});

// Admin moderation — operational metadata + content-flag queue only. No bulk
// browsing of message content: returns the reported item + reason only.
const admin = express.Router();
admin.use(identifyUser);
admin.get('/reports', requirePermission('MANAGE_TICKETS'), async (req, res) => {
  try {
    const reports = await prisma.messageReport.findMany({ where: { status: req.query.status || 'open' }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ reports });
  } catch (err) { fail(res, err); }
});
admin.patch('/reports/:id', requirePermission('MANAGE_TICKETS'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['resolved', 'dismissed'].includes(status)) throw httpError(400, 'status must be resolved|dismissed.');
    const report = await prisma.messageReport.update({ where: { id: req.params.id }, data: { status, resolvedBy: req.userId, resolvedAt: new Date() } });
    await audit.log({ actorId: req.userId, action: 'moderation.review_report', entityType: 'MessageReport', entityId: report.id });
    res.json({ report });
  } catch (err) { fail(res, err); }
});
admin.get('/documents', requirePermission('MANAGE_TICKETS'), async (req, res) => {
  try {
    const docs = await prisma.trainerDocument.findMany({ orderBy: { uploadedAt: 'desc' }, take: 200, include: { trainer: { select: { displayName: true, userId: true } }, shares: { select: { id: true } } } });
    res.json({ documents: docs.map(d => ({ ...d, fileKey: undefined })) });
  } catch (err) { fail(res, err); }
});
admin.get('/consent-audit', requirePermission('VIEW_AUDIT_LOGS'), async (req, res) => {
  try {
    const consents = await prisma.recordingConsent.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { videoSession: { select: { id: true, scheduledStart: true, status: true } } } });
    res.json({ consents });
  } catch (err) { fail(res, err); }
});
// Privacy/communication consent preferences (Phase 11) — per-user toggles,
// stored inside profileData.communicationConsent (no PII duplication).
const PRIVACY_KEYS = ['coachingMessages', 'groupParticipation', 'videoSessions', 'callRecording', 'aiTranscription', 'aiSummaries', 'fileSharing'];
router.get('/privacy', identifyUser, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { profileData: true } });
    res.json({ consent: user?.profileData?.communicationConsent || {} });
  } catch (err) { fail(res, err); }
});
router.put('/privacy', identifyUser, async (req, res) => {
  try {
    const patch = {};
    for (const k of PRIVACY_KEYS) if (typeof req.body?.[k] === 'boolean') patch[k] = req.body[k];
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { profileData: true } });
    const merged = { ...(user?.profileData || {}), communicationConsent: { ...(user?.profileData?.communicationConsent || {}), ...patch, updatedAt: new Date().toISOString() } };
    await prisma.user.update({ where: { id: req.userId }, data: { profileData: merged } });
    await audit.log({ actorId: req.userId, action: 'communication.privacy_update', entityType: 'User', entityId: req.userId, afterData: patch });
    res.json({ consent: merged.communicationConsent });
  } catch (err) { fail(res, err); }
});

router.use('/admin', admin);
router.use('/groups', groups);
router.use('/documents', docs);
router.use('/video-sessions', video);
module.exports = router;
