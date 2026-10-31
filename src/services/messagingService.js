// Trainer↔client 1:1 messaging. Conversations are keyed to the TrainerClient
// relation itself — no arbitrary DMs. Ended relations become read-only
// archives: history stays readable by both participants, new sends 403.
// Message bodies are never written to audit logs or push payloads.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const {
  requireActiveRelation,
  requireRelationParticipant,
  forbidden,
} = require('./trainerAccess');
const audit = require('./auditService');
const { sendPushToUser } = require('./pushService');

const MAX_BODY = 4000;
const MAX_PAGE = 50;

const participantWhere = (userId) => ({
  OR: [{ relation: { clientId: userId } }, { relation: { trainer: { userId } } }],
});

/**
 * Find-or-create the 1:1 conversation for a trainer↔client pair.
 * Requires an active relation. Pass { trainerUserId, clientUserId } from the
 * trainer side or { trainerId, clientUserId } from the client side.
 */
async function getOrCreateConversation({ trainerUserId, trainerId, clientUserId }) {
  const prisma = getPrisma();
  const { relation } = await requireActiveRelation({ trainerUserId, trainerId, clientUserId });
  const existing = await prisma.conversation.findUnique({ where: { relationId: relation.id } });
  if (existing) return { conversation: existing, created: false };
  try {
    const conversation = await prisma.conversation.create({ data: { relationId: relation.id } });
    return { conversation, created: true };
  } catch (err) {
    if (err && err.code === 'P2002') {
      // Concurrent create — the conversation now exists; return it.
      const conversation = await prisma.conversation.findUnique({ where: { relationId: relation.id } });
      return { conversation, created: false };
    }
    throw err;
  }
}

/** Every conversation the caller participates in, newest activity first. */
async function listConversations(userId) {
  const prisma = getPrisma();
  const conversations = await prisma.conversation.findMany({
    where: participantWhere(userId),
    include: {
      relation: {
        include: {
          trainer: { select: { id: true, userId: true, displayName: true, profilePicture: true } },
        },
      },
      messages: { where: { deletedAt: null }, orderBy: { id: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const ids = conversations.map((c) => c.id);
  const grouped = ids.length
    ? await prisma.message.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: ids }, senderId: { not: userId }, readAt: null, deletedAt: null },
        _count: { _all: true },
      })
    : [];
  const unread = new Map(grouped.map((g) => [g.conversationId, g._count._all]));
  return conversations.map((c) => ({
    id: c.id,
    relationId: c.relationId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    role: c.relation.clientId === userId ? 'client' : 'trainer',
    relationStatus: c.relation.status,
    trainer: c.relation.trainer,
    clientId: c.relation.clientId,
    lastMessage: c.messages[0] || null,
    unreadCount: unread.get(c.id) || 0,
  }));
}

async function loadParticipantConversation(conversationId, userId) {
  const prisma = getPrisma();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { relation: { include: { trainer: { select: { userId: true } } } } },
  });
  if (!conversation) throw httpError(404, 'Conversation not found.');
  const relation = await requireRelationParticipant(conversation.relationId, userId);
  return { conversation, relation };
}

/** Cursor-paginated history (id asc, `after` = last seen id). Read-only archive safe. */
async function listMessages(conversationId, userId, { after, limit } = {}) {
  await loadParticipantConversation(conversationId, userId);
  let take = MAX_PAGE;
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) throw httpError(400, 'Invalid limit.');
    take = Math.min(n, MAX_PAGE);
  }
  const where = { conversationId, deletedAt: null };
  if (after !== undefined) {
    if (typeof after !== 'string' || !after) throw httpError(400, 'Invalid cursor.');
    const anchor = await getPrisma().message.findUnique({
      where: { id: after },
      select: { createdAt: true },
    });
    if (!anchor || anchor.createdAt === undefined) throw httpError(400, 'Invalid cursor.');
    // Composite (createdAt, id) cursor — uuid ids are not chronological.
    where.OR = [
      { createdAt: { gt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { gt: after } },
    ];
  }
  const messages = await getPrisma().message.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
  });
  return {
    messages,
    nextCursor: messages.length === take ? messages[messages.length - 1].id : null,
  };
}

/**
 * Send a message. Requires active relation — ended relations are read-only
 * archives. Notifies the other participant (generic body, never message text).
 */
async function sendMessage(conversationId, senderId, body) {
  const prisma = getPrisma();
  const { relation } = await loadParticipantConversation(conversationId, senderId);
  if (relation.status !== 'active') throw forbidden('Coaching relationship ended.');
  const text = String(body == null ? '' : body).trim();
  if (!text || text.length > MAX_BODY) {
    throw httpError(400, `Message body must be 1-${MAX_BODY} characters.`);
  }
  const message = await prisma.message.create({
    data: { conversationId, senderId, body: text },
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

  const recipientId = relation.clientId === senderId ? relation.trainer.userId : relation.clientId;
  try {
    await prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'trainer.message',
        title: 'New message',
        body: 'You have a new coaching message',
      },
    });
  } catch (err) {
    // Inbox row is best-effort; never fail a delivered message over it.
  }
  await sendPushToUser(recipientId, {
    title: 'New message',
    body: 'You have a new coaching message',
    data: { conversationId },
  });
  return message;
}

/** Mark everything the other party sent, up to and including lastMessageId, as read. */
async function markRead(conversationId, userId, lastMessageId) {
  await loadParticipantConversation(conversationId, userId);
  if (typeof lastMessageId !== 'string' || !lastMessageId) {
    throw httpError(400, 'lastMessageId required.');
  }
  const anchor = await getPrisma().message.findUnique({
    where: { id: lastMessageId },
    select: { createdAt: true, conversationId: true },
  });
  if (!anchor || anchor.conversationId !== conversationId) throw httpError(400, 'Invalid lastMessageId.');
  const result = await getPrisma().message.updateMany({
    where: {
      conversationId,
      senderId: { not: userId },
      readAt: null,
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lte: lastMessageId } },
      ],
    },
    data: { readAt: new Date() },
  });
  return { markedRead: result.count };
}

/** Total unread across all of the caller's conversations. */
async function unreadCount(userId) {
  const prisma = getPrisma();
  const conversations = await prisma.conversation.findMany({
    where: participantWhere(userId),
    select: { id: true },
  });
  const ids = conversations.map((c) => c.id);
  if (!ids.length) return { count: 0 };
  const count = await prisma.message.count({
    where: { conversationId: { in: ids }, senderId: { not: userId }, readAt: null, deletedAt: null },
  });
  return { count };
}

/** Abuse report — audit metadata only, message bodies are never logged. */
async function reportConversation(conversationId, userId) {
  await loadParticipantConversation(conversationId, userId);
  await audit.log({
    actorId: userId,
    action: 'message.report',
    entityType: 'Conversation',
    entityId: conversationId,
    afterData: { userId },
  });
  return { reported: true };
}

module.exports = {
  getOrCreateConversation,
  listConversations,
  listMessages,
  sendMessage,
  markRead,
  unreadCount,
  reportConversation,
};
