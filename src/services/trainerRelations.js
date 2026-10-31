// Trainer↔client relationship lifecycle — request/accept/decline/invite,
// per-category consent management, and ending a relationship.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const {
  CONSENT_CATEGORIES,
  forbidden,
  requireApprovedTrainer,
} = require('./trainerAccess');
const trainerService = require('./trainerService');

/** First day of next month (UTC midnight) — same lock rule as subscriptions. */
function firstDayOfNextMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

async function notify(userId, type, title, body, prisma) {
  await prisma.notification.create({ data: { userId, type, title, body } });
}

async function loadRelation(relationId, prisma) {
  const relation = await prisma.trainerClient.findUnique({
    where: { id: relationId },
    include: { trainer: true },
  });
  if (!relation) throw httpError(404, 'Relationship not found.');
  return relation;
}

/** Caller must be the party that did NOT initiate the request. */
function assertConfirmer(relation, userId) {
  if (relation.requestedBy === 'client') {
    if (relation.trainer.userId !== userId) throw forbidden('Only the trainer can accept this request.');
    return 'trainer';
  }
  if (relation.clientId !== userId) throw forbidden('Only the client can accept this invitation.');
  return 'client';
}

function callerSide(relation, userId) {
  if (relation.trainer.userId === userId) return 'trainer';
  if (relation.clientId === userId) return 'client';
  return null;
}

// ---------------------------------------------------------------------------
// Pending request listings
// ---------------------------------------------------------------------------

/** Trainer view: pending requests awaiting their answer. */
async function listPendingRequestsForTrainer(userId) {
  const prisma = getPrisma();
  const trainer = await requireApprovedTrainer(userId);
  const requests = await prisma.trainerClient.findMany({
    where: { trainerId: trainer.id, status: 'pending' },
    orderBy: { assignedAt: 'desc' },
    include: { consents: true },
  });
  const nameMap = await trainerService.loadDisplayNames(requests.map((r) => r.clientId));
  return requests.map((r) => ({ ...r, clientName: nameMap.get(r.clientId) || 'Client' }));
}

/** Client view: own pending requests/invitations (?mine=1). */
async function listPendingRequestsForClient(userId) {
  const prisma = getPrisma();
  const requests = await prisma.trainerClient.findMany({
    where: { clientId: userId, status: 'pending' },
    orderBy: { assignedAt: 'desc' },
    include: { trainer: true, consents: true },
  });
  const nameMap = await trainerService.loadDisplayNames(requests.map((r) => r.trainer.userId));
  return requests.map((r) => ({
    ...r,
    trainer: { ...r.trainer, displayName: trainerService.publicTrainerName(r.trainer, nameMap) },
  }));
}

// ---------------------------------------------------------------------------
// Accept / decline / invite
// ---------------------------------------------------------------------------

/**
 * The non-requesting party confirms a pending request → relation goes active
 * and the billing-style lock begins (first day of next month). Consent rows
 * stay `pending` — the client grants categories explicitly afterwards.
 */
async function acceptRequest(relationId, userId, prisma = getPrisma()) {
  const relation = await loadRelation(relationId, prisma);
  if (relation.status !== 'pending') throw httpError(409, `Request is ${relation.status}, not pending.`);
  const side = assertConfirmer(relation, userId);

  const activeCount = await prisma.trainerClient.count({
    where: { trainerId: relation.trainerId, status: 'active' },
  });
  if (activeCount >= relation.trainer.maxClients) {
    throw httpError(409, `Trainer at capacity (${relation.trainer.maxClients} clients max).`);
  }

  const updated = await prisma.trainerClient.update({
    where: { id: relation.id },
    data: { status: 'active', startedAt: new Date(), lockedUntil: firstDayOfNextMonth() },
  });
  const requesterId = relation.requestedBy === 'client' ? relation.clientId : relation.trainer.userId;
  await notify(
    requesterId,
    'trainer_request_accepted',
    'Coaching request accepted',
    'Your trainer coaching request was accepted. Review which data you want to share.',
    prisma
  );
  return { relation: updated, side };
}

/**
 * Decline (non-requester) or cancel (requester) a pending request → 'dropped'.
 */
async function declineRequest(relationId, userId, prisma = getPrisma()) {
  const relation = await loadRelation(relationId, prisma);
  if (relation.status !== 'pending') throw httpError(409, `Request is ${relation.status}, not pending.`);
  const side = callerSide(relation, userId);
  if (!side) throw forbidden('Not a participant of this request.');

  const requester = relation.requestedBy === 'client' ? 'client' : 'trainer';
  const reason = side === requester ? 'cancelled' : 'declined';
  const now = new Date();
  const [updated] = await Promise.all([
    prisma.trainerClient.update({
      where: { id: relation.id },
      data: { status: 'dropped', droppedBy: side, dropReason: reason },
    }),
    prisma.trainerClientConsent.updateMany({
      where: { relationId: relation.id, status: 'pending' },
      data: { status: 'revoked', revokedAt: now },
    }),
  ]);
  const otherId = side === 'client' ? relation.trainer.userId : relation.clientId;
  await notify(
    otherId,
    'trainer_request_declined',
    `Coaching request ${reason}`,
    `A trainer coaching request was ${reason}.`,
    prisma
  );
  return { relation: updated, side, reason };
}

/**
 * Trainer-initiated request: invite a client. If the client already requested
 * this trainer, the invite acts as the trainer's acceptance (mutual intent).
 */
async function inviteClient(trainerUserId, clientId, prisma = getPrisma()) {
  if (!clientId || typeof clientId !== 'string') throw httpError(400, 'clientId required.');
  const trainer = await requireApprovedTrainer(trainerUserId);
  if (clientId === trainerUserId) throw httpError(400, 'Trainers cannot coach themselves.');

  const existing = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainer.id, clientId } },
  });
  if (existing) {
    if (existing.status === 'active') throw httpError(409, 'Client relationship already active.');
    if (existing.status === 'pending') {
      if (existing.requestedBy === 'trainer') return { relation: existing, side: 'trainer' };
      // Client asked first — inviting back is the trainer's acceptance.
      return { relation: await activatePending(existing, trainer, prisma), side: 'trainer' };
    }
    if (!['completed', 'dropped'].includes(existing.status)) {
      throw httpError(409, `Relationship is ${existing.status}.`);
    }
  }

  const taken = await prisma.trainerClient.count({
    where: { trainerId: trainer.id, status: { in: ['active', 'pending'] } },
  });
  if (taken >= trainer.maxClients) {
    throw httpError(409, `Trainer at capacity (${trainer.maxClients} clients max).`);
  }

  const now = new Date();
  const relation = await prisma.trainerClient.upsert({
    where: { trainerId_clientId: { trainerId: trainer.id, clientId } },
    update: {
      status: 'pending',
      requestedBy: 'trainer',
      startedAt: now,
      lockedUntil: null,
      droppedBy: null,
      dropReason: null,
    },
    create: {
      trainerId: trainer.id,
      clientId,
      status: 'pending',
      requestedBy: 'trainer',
      startedAt: now,
    },
  });
  await trainerService.provisionPendingConsents(relation.id, prisma);
  await notify(
    clientId,
    'trainer_invite',
    'Trainer invitation',
    'A trainer invited you to coach with them. Accept to start the relationship.',
    prisma
  );
  return { relation, side: 'trainer' };
}

async function activatePending(relation, trainer, prisma) {
  const activeCount = await prisma.trainerClient.count({
    where: { trainerId: trainer.id, status: 'active' },
  });
  if (activeCount >= trainer.maxClients) {
    throw httpError(409, `Trainer at capacity (${trainer.maxClients} clients max).`);
  }
  const updated = await prisma.trainerClient.update({
    where: { id: relation.id },
    data: { status: 'active', startedAt: new Date(), lockedUntil: firstDayOfNextMonth() },
  });
  await notify(
    relation.clientId,
    'trainer_request_accepted',
    'Coaching request accepted',
    'Your trainer coaching request was accepted. Review which data you want to share.',
    prisma
  );
  return updated;
}

// ---------------------------------------------------------------------------
// Consent management (client-owned)
// ---------------------------------------------------------------------------

/** All consent categories with current status — relation participants only. */
async function getConsents(relationId, userId, prisma = getPrisma()) {
  // Mirrors trainerAccess.requireRelationParticipant but runs on `prisma`
  // (may be a transaction handle — must not read via a second connection).
  const relation = await prisma.trainerClient.findUnique({
    where: { id: relationId },
    include: { trainer: { select: { userId: true } } },
  });
  if (!relation) throw httpError(404, 'Relationship not found.');
  if (relation.clientId !== userId && relation.trainer.userId !== userId) {
    throw forbidden('Not a participant of this relationship.');
  }
  const rows = await prisma.trainerClientConsent.findMany({
    where: { relationId: relation.id },
  });
  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return {
    relationId: relation.id,
    relationStatus: relation.status,
    consents: CONSENT_CATEGORIES.map((category) => {
      const row = byCategory.get(category);
      return {
        category,
        status: row ? row.status : 'pending',
        grantedAt: row ? row.grantedAt : null,
        revokedAt: row ? row.revokedAt : null,
        policyVersion: row ? row.policyVersion : 'v1',
      };
    }),
  };
}

/**
 * PUT consents {grants:[], revokes:[]} — client only. Grants set grantedAt;
 * revokes set revokedAt and take effect immediately server-side.
 */
async function updateConsents(relationId, userId, { grants = [], revokes = [] } = {}, prisma = getPrisma()) {
  const relation = await loadRelation(relationId, prisma);
  if (relation.clientId !== userId) throw forbidden('Only the client can manage consent.');
  if (!['pending', 'active'].includes(relation.status)) {
    throw httpError(409, `Cannot change consent on a ${relation.status} relationship.`);
  }
  for (const list of [grants, revokes]) {
    if (!Array.isArray(list)) throw httpError(400, 'grants and revokes must be arrays.');
    for (const category of list) {
      if (!CONSENT_CATEGORIES.includes(category)) throw httpError(400, `Unknown consent category: ${category}`);
      if (list === revokes && grants.includes(category)) {
        throw httpError(400, `Category ${category} cannot be granted and revoked at once.`);
      }
    }
  }

  const now = new Date();
  for (const category of grants) {
    await prisma.trainerClientConsent.upsert({
      where: { relationId_category: { relationId: relation.id, category } },
      update: { status: 'granted', grantedAt: now, revokedAt: null },
      create: { relationId: relation.id, category, status: 'granted', grantedAt: now },
    });
  }
  for (const category of revokes) {
    await prisma.trainerClientConsent.upsert({
      where: { relationId_category: { relationId: relation.id, category } },
      update: { status: 'revoked', revokedAt: now },
      create: { relationId: relation.id, category, status: 'revoked', revokedAt: now },
    });
  }
  return getConsents(relation.id, userId, prisma);
}

// ---------------------------------------------------------------------------
// End relationship (either participant)
// ---------------------------------------------------------------------------

async function endRelationship(relationId, userId, prisma = getPrisma()) {
  const relation = await loadRelation(relationId, prisma);
  const side = callerSide(relation, userId);
  if (!side) throw forbidden('Not a participant of this relationship.');
  if (relation.status === 'dropped') throw httpError(409, 'Relationship already ended.');

  const now = new Date();
  const [updated] = await Promise.all([
    prisma.trainerClient.update({
      where: { id: relation.id },
      data: { status: 'dropped', droppedBy: side },
    }),
    prisma.trainerClientConsent.updateMany({
      where: { relationId: relation.id, status: { not: 'revoked' } },
      data: { status: 'revoked', revokedAt: now },
    }),
  ]);
  const otherId = side === 'client' ? relation.trainer.userId : relation.clientId;
  await notify(
    otherId,
    'trainer_relationship_ended',
    'Coaching relationship ended',
    'A trainer coaching relationship was ended.',
    prisma
  );
  return { relation: updated, side };
}

module.exports = {
  listPendingRequestsForTrainer,
  listPendingRequestsForClient,
  acceptRequest,
  declineRequest,
  inviteClient,
  getConsents,
  updateConsents,
  endRelationship,
};
