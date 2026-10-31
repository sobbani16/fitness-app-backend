// Shared trainer-platform authorization helpers.
// Every trainer↔client data path funnels through these:
//   approved trainer profile → active relation → per-category consent.
const { getPrisma } = require('../lib/prisma');

const CONSENT_CATEGORIES = [
  'workout_records',
  'food_logs',
  'nutrition_summaries',
  'weight_trends',
  'sleep_summaries',
  'step_counts',
  'body_measurements',
  'health_scores',
];

function forbidden(msg) {
  const e = new Error(msg || 'Forbidden');
  e.status = 403;
  return e;
}

/** Approved trainer profile for a user, or throws 403. */
async function requireApprovedTrainer(userId) {
  const prisma = getPrisma();
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!trainer || !trainer.verified || !trainer.active || trainer.applicationStatus !== 'approved') {
    throw forbidden('Approved trainer status required.');
  }
  return trainer;
}

/**
 * Active trainer↔client relation for a pair, or throws 403.
 * Pass either the trainer's userId (trainer-side call) or trainer profile id.
 */
async function requireActiveRelation({ trainerUserId, trainerId, clientUserId }) {
  const prisma = getPrisma();
  let tid = trainerId;
  let trainer = null;
  if (!tid) {
    trainer = await prisma.trainerProfile.findUnique({ where: { userId: trainerUserId } });
    if (!trainer || !trainer.verified || !trainer.active) throw forbidden('Approved trainer status required.');
    tid = trainer.id;
  }
  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: tid, clientId: clientUserId } },
  });
  if (!relation || relation.status !== 'active') throw forbidden('No active coaching relationship.');
  return { relation, trainer, trainerId: tid };
}

/** Set of categories currently granted on a relation. */
async function getGrantedCategories(relationId) {
  const prisma = getPrisma();
  const rows = await prisma.trainerClientConsent.findMany({
    where: { relationId, status: 'granted' },
    select: { category: true },
  });
  return new Set(rows.map((r) => r.category));
}

async function hasConsent(relationId, category) {
  const prisma = getPrisma();
  const row = await prisma.trainerClientConsent.findUnique({
    where: { relationId_category: { relationId, category } },
    select: { status: true },
  });
  return !!row && row.status === 'granted';
}

/** Participant check for a conversation relation: caller is trainer-owner or client. */
async function requireRelationParticipant(relationId, userId) {
  const prisma = getPrisma();
  const relation = await prisma.trainerClient.findUnique({
    where: { id: relationId },
    include: { trainer: { select: { userId: true } } },
  });
  if (!relation) throw forbidden('Relationship not found.');
  if (relation.clientId !== userId && relation.trainer.userId !== userId) {
    throw forbidden('Not a participant of this relationship.');
  }
  return relation;
}

module.exports = {
  CONSENT_CATEGORIES,
  forbidden,
  requireApprovedTrainer,
  requireActiveRelation,
  requireRelationParticipant,
  getGrantedCategories,
  hasConsent,
};
