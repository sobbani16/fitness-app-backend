// Trainer partnership mode v1 — the member's declared coaching model plus
// the precedence rules other engines must honor:
//   trainer_led  → the coach's plan comes first; Humai never silently
//                  substitutes an AI/self plan for an absent trainer plan.
//   hybrid       → trainer_first surfaces coach plans ahead of Humai ones;
//                  humai_first reverses it. Both keep member restrictions.
//   self_guided / humai_assisted → no trainer precedence applied.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

const MODELS = ['self_guided', 'humai_assisted', 'trainer_led', 'hybrid'];
const PRECEDENCE = ['trainer_first', 'humai_first'];

const safe = (p, fallback = null) => Promise.resolve().then(p).catch(() => fallback);

async function getPreference(userId) {
  const prisma = getPrisma();
  const [pref, relation] = await Promise.all([
    safe(() => prisma.coachingPreference.findUnique({ where: { userId } })),
    safe(() => prisma.trainerClient.findFirst({ where: { clientId: userId, status: 'active' }, select: { id: true, trainerId: true } })),
  ]);
  const hasActiveTrainer = Boolean(relation);
  const model = pref?.model || 'self_guided';
  // A trainer-dependent model with no active relationship can't apply trainer
  // precedence — the preference is kept but reported as inactive context.
  return {
    model,
    planPrecedence: pref?.planPrecedence || 'trainer_first',
    shareInsightsWithTrainer: pref?.shareInsightsWithTrainer ?? false,
    hasActiveTrainer,
    relationId: relation?.id || null,
    trainerPlanFirst: hasActiveTrainer && (model === 'trainer_led' || (model === 'hybrid' && (pref?.planPrecedence || 'trainer_first') === 'trainer_first')),
    trainerStrict: hasActiveTrainer && model === 'trainer_led',
    options: { models: MODELS, precedence: PRECEDENCE },
    note: 'Trainer plans take precedence in trainer-led and trainer-first hybrid modes. Humai never silently replaces a trainer plan.',
  };
}

async function updatePreference(userId, { model, planPrecedence, shareInsightsWithTrainer } = {}) {
  const data = {};
  if (model !== undefined) {
    if (!MODELS.includes(model)) throw httpError(400, `model must be one of: ${MODELS.join(', ')}`);
    data.model = model;
  }
  if (planPrecedence !== undefined) {
    if (!PRECEDENCE.includes(planPrecedence)) throw httpError(400, `planPrecedence must be one of: ${PRECEDENCE.join(', ')}`);
    data.planPrecedence = planPrecedence;
  }
  if (shareInsightsWithTrainer !== undefined) {
    if (typeof shareInsightsWithTrainer !== 'boolean') throw httpError(400, 'shareInsightsWithTrainer must be a boolean');
    data.shareInsightsWithTrainer = shareInsightsWithTrainer;
  }
  if (!Object.keys(data).length) throw httpError(400, 'Nothing to update.');
  const p = await getPrisma().coachingPreference.upsert({
    where: { userId }, update: data, create: { userId, ...data },
  });
  return getPreference(userId).then(r => ({ ...r, saved: p }));
}

module.exports = { MODELS, PRECEDENCE, getPreference, updatePreference };
