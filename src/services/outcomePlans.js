// Shared outcome plans v1 — an explicit agreement between coach and member.
// One active plan per relationship. Every revision supersedes the previous
// version and records an OutcomePlanAdjustment — the member can always see
// what changed and when. Goals may be qualitative; missing measurements are
// never treated as failure.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireApprovedTrainer, requireRelationParticipant } = require('./trainerAccess');

const KINDS = ['workout_consistency', 'strength', 'functional_movement', 'dietary_habit', 'weight_trend', 'sleep_regularity', 'confidence', 'custom'];
const SOURCES = ['workout_records', 'weight_trends', 'check_ins', 'habit_completions', 'self_report', 'trainer_assessment'];
const GOAL_STATUS = ['open', 'met', 'dropped'];
const CLOSE_STATUS = ['completed', 'archived'];

function cleanStr(v, key, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.length > max) throw httpError(400, `${key} exceeds ${max} characters`);
  return s || null;
}

function validateGoal(g, i) {
  if (typeof g !== 'object' || g === null) throw httpError(400, `goals[${i}] must be an object`);
  const title = cleanStr(g.title, `goals[${i}].title`, 160);
  if (!title || title.length < 2) throw httpError(400, `goals[${i}].title is required (2–160 chars)`);
  const kind = g.kind ?? 'custom';
  if (!KINDS.includes(kind)) throw httpError(400, `goals[${i}].kind must be one of: ${KINDS.join(', ')}`);
  const progressSource = g.progressSource ?? 'self_report';
  if (!SOURCES.includes(progressSource)) throw httpError(400, `goals[${i}].progressSource must be one of: ${SOURCES.join(', ')}`);
  let reviewIntervalDays = g.reviewIntervalDays ?? 7;
  if (!Number.isInteger(reviewIntervalDays) || reviewIntervalDays < 1 || reviewIntervalDays > 90) throw httpError(400, `goals[${i}].reviewIntervalDays must be 1–90`);
  let targetDate = null;
  if (g.targetDate != null) {
    targetDate = new Date(g.targetDate);
    if (!Number.isFinite(targetDate.getTime())) throw httpError(400, `goals[${i}].targetDate is invalid`);
  }
  let sortOrder = g.sortOrder ?? i;
  if (!Number.isInteger(sortOrder)) sortOrder = i;
  return {
    kind, title, sortOrder, reviewIntervalDays, progressSource, targetDate,
    baseline: cleanStr(g.baseline, `goals[${i}].baseline`, 300),
    target: cleanStr(g.target, `goals[${i}].target`, 300),
    notes: cleanStr(g.notes, `goals[${i}].notes`, 1000),
  };
}

function validateGoals(goals) {
  if (!Array.isArray(goals) || !goals.length) throw httpError(400, 'goals must be a non-empty list (max 10)');
  if (goals.length > 10) throw httpError(400, 'goals must be a non-empty list (max 10)');
  return goals.map(validateGoal);
}

async function requireOwnedRelation(trainerUserId, relationId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const relation = await getPrisma().trainerClient.findUnique({ where: { id: relationId } });
  if (!relation || relation.trainerId !== trainer.id) throw httpError(403, 'Not your client.');
  if (relation.status !== 'active') throw httpError(409, 'Coaching relationship is not active.');
  return { trainer, relation };
}

async function requireOwnedPlan(trainerUserId, planId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plan = await getPrisma().outcomePlan.findUnique({ where: { id: planId }, include: { goals: { orderBy: { sortOrder: 'asc' } } } });
  if (!plan || plan.trainerId !== trainer.id) throw httpError(404, 'Outcome plan not found.');
  return { trainer, plan };
}

// Trainer creates the first version of the shared plan for a relationship.
async function createPlan(trainerUserId, { relationId, note, goals } = {}) {
  if (typeof relationId !== 'string' || !relationId) throw httpError(400, 'relationId required');
  const { relation } = await requireOwnedRelation(trainerUserId, relationId);
  const prisma = getPrisma();
  const existing = await prisma.outcomePlan.findFirst({ where: { relationId, status: 'active' } });
  if (existing) throw httpError(409, 'An active outcome plan already exists — revise it instead.');
  const clean = validateGoals(goals);
  return prisma.outcomePlan.create({
    data: {
      relationId, trainerId: relation.trainerId, clientId: relation.clientId,
      note: cleanStr(note, 'note', 1000), createdBy: trainerUserId,
      goals: { create: clean },
    },
    include: { goals: { orderBy: { sortOrder: 'asc' } } },
  });
}

// Trainer revises the plan: the previous version is superseded, the new one
// carries the full goal set, and an adjustment row explains the change.
async function revisePlan(trainerUserId, planId, { note, goals, summary } = {}) {
  const { plan } = await requireOwnedPlan(trainerUserId, planId);
  if (plan.status !== 'active') throw httpError(409, 'Only the active version can be revised.');
  const prisma = getPrisma();
  const clean = goals === undefined ? null : validateGoals(goals);
  const nextGoals = clean || plan.goals.map(g => ({
    kind: g.kind, title: g.title, baseline: g.baseline, target: g.target,
    targetDate: g.targetDate, reviewIntervalDays: g.reviewIntervalDays,
    progressSource: g.progressSource, notes: g.notes, sortOrder: g.sortOrder,
  }));
  const autoSummary = summary?.trim() || diffSummary(plan, note, clean);
  // Atomic: the new version and the supersede marker commit together — the
  // one-active-version invariant must never dangle.
  const [created] = await prisma.$transaction([
    prisma.outcomePlan.create({
      data: {
        relationId: plan.relationId, trainerId: plan.trainerId, clientId: plan.clientId,
        version: plan.version + 1, supersedesId: plan.id,
        note: note !== undefined ? cleanStr(note, 'note', 1000) : plan.note,
        createdBy: trainerUserId,
        goals: { create: nextGoals },
        adjustments: { create: { adjustedBy: trainerUserId, summary: autoSummary.slice(0, 500) } },
      },
      include: { goals: { orderBy: { sortOrder: 'asc' } }, adjustments: true },
    }),
    prisma.outcomePlan.update({ where: { id: plan.id }, data: { status: 'superseded' } }),
  ]);
  return created;
}

function diffSummary(prev, note, clean) {
  const parts = [`Plan v${prev.version + 1}`];
  if (note !== undefined) parts.push('note updated');
  if (clean) {
    const oldTitles = new Set(prev.goals.map(g => g.title));
    const newTitles = new Set(clean.map(g => g.title));
    const added = clean.filter(g => !oldTitles.has(g.title)).length;
    const removed = prev.goals.filter(g => !newTitles.has(g.title)).length;
    const changed = clean.filter(g => oldTitles.has(g.title)).length;
    if (added) parts.push(`${added} goal${added > 1 ? 's' : ''} added`);
    if (removed) parts.push(`${removed} goal${removed > 1 ? 's' : ''} removed`);
    if (changed) parts.push(`${changed} goal${changed > 1 ? 's' : ''} carried over`);
  } else parts.push('goals carried over unchanged');
  return parts.join('; ');
}

// Active plan + goals for a relationship — either participant.
async function getActivePlan(relationId, userId) {
  await requireRelationParticipant(relationId, userId);
  const plan = await getPrisma().outcomePlan.findFirst({
    where: { relationId, status: 'active' },
    include: { goals: { orderBy: { sortOrder: 'asc' } }, adjustments: { orderBy: { createdAt: 'desc' } } },
  });
  return { version: 'outcome-plans-v1', plan, note: 'Goals may be qualitative — missing measurements are never treated as failure.' };
}

// Full version history for a relationship — either participant.
async function listVersions(relationId, userId) {
  await requireRelationParticipant(relationId, userId);
  const plans = await getPrisma().outcomePlan.findMany({
    where: { relationId }, orderBy: { version: 'desc' },
    include: { goals: { orderBy: { sortOrder: 'asc' } }, adjustments: true },
  });
  return { versions: plans };
}

async function getPlan(planId, userId) {
  const plan = await getPrisma().outcomePlan.findUnique({
    where: { id: planId },
    include: { goals: { orderBy: { sortOrder: 'asc' } }, adjustments: true },
  });
  if (!plan) throw httpError(404, 'Outcome plan not found.');
  await requireRelationParticipant(plan.relationId, userId);
  return plan;
}

// Member's own plans across relationships.
async function listMine(userId) {
  const plans = await getPrisma().outcomePlan.findMany({
    where: { clientId: userId }, orderBy: { updatedAt: 'desc' }, take: 20,
    include: { goals: { orderBy: { sortOrder: 'asc' } } },
  });
  return { plans };
}

// Trainer's plans, optionally filtered to one client.
async function listForTrainer(trainerUserId, clientId) {
  const trainer = await requireApprovedTrainer(trainerUserId);
  const plans = await getPrisma().outcomePlan.findMany({
    where: { trainerId: trainer.id, ...(clientId ? { clientId: String(clientId) } : {}) },
    orderBy: { updatedAt: 'desc' }, take: 100,
    include: { goals: { orderBy: { sortOrder: 'asc' } } },
  });
  return { plans };
}

// Either participant may update a goal's status — members self-report
// progress; the trainer marks reviews. Only open|met|dropped.
async function updateGoalStatus(userId, goalId, { status, notes } = {}) {
  if (!GOAL_STATUS.includes(status)) throw httpError(400, `status must be one of: ${GOAL_STATUS.join(', ')}`);
  const prisma = getPrisma();
  const goal = await prisma.outcomeGoal.findUnique({ where: { id: goalId }, include: { plan: true } });
  if (!goal) throw httpError(404, 'Goal not found.');
  await requireRelationParticipant(goal.plan.relationId, userId);
  const data = { status };
  if (notes !== undefined) data.notes = cleanStr(notes, 'notes', 1000);
  return prisma.outcomeGoal.update({ where: { id: goalId }, data });
}

// Trainer closes a plan — completed or archived.
async function closePlan(trainerUserId, planId, status) {
  if (!CLOSE_STATUS.includes(status)) throw httpError(400, `status must be one of: ${CLOSE_STATUS.join(', ')}`);
  await requireOwnedPlan(trainerUserId, planId);
  return getPrisma().outcomePlan.update({ where: { id: planId }, data: { status } });
}

module.exports = {
  KINDS, SOURCES, GOAL_STATUS,
  createPlan, revisePlan, getActivePlan, listVersions, getPlan,
  listMine, listForTrainer, updateGoalStatus, closePlan,
};
