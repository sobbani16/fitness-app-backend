// Super-admin nutrition-profile review — /super-admin/nutrition-profiles.
// Gate: NUTRITION_DATA_REVIEW permission. Lifecycle: pending (verifiedAt NULL)
// → APPROVED (verifiedAt set) | REJECTED | CHANGES_REQUESTED → REVOKED.
// Only verifiedAt!=NULL profiles reach intelligence consumers (fail-closed).
// Decisions are immutable in AuditLog; profile rows keep original provenance.
const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { requirePermission } = require('../middleware/rbac');
const audit = require('../services/auditService');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const prisma = new Proxy({}, { get: (_t, prop) => getPrisma()[prop] });
const REVIEW = requirePermission('NUTRITION_DATA_REVIEW');
const DECISIONS = ['APPROVE', 'REJECT', 'REQUEST_CHANGES'];
const actor = (req) => req.userId || req.user?.id;

// List profiles (default pending), incl. nutrients + ingredient identity.
router.get('/', REVIEW, wrap(async (req, res) => {
  const where = {};
  if (req.query.batch) where.sourceDataset = String(req.query.batch).slice(0, 200);
  if (req.query.status === 'pending') where.verifiedAt = null;
  else if (req.query.status === 'verified') where.verifiedAt = { not: null };
  const profiles = await prisma.ingredientNutritionProfile.findMany({
    where,
    include: { nutrients: { include: { nutrient: { select: { code: true, unit: true } } } },
               ingredient: { select: { id: true, name: true, fdcId: true } } },
    orderBy: [{ sourceDataset: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Number(req.query.limit) || 200, 500),
  });
  res.json({ profiles });
}));

// Decision history for one profile (audit trail).
router.get('/:id/history', REVIEW, wrap(async (req, res) => {
  const entries = await prisma.auditLog.findMany({
    where: { entityType: 'IngredientNutritionProfile', entityId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ history: entries });
}));

// APPROVE | REJECT | REQUEST_CHANGES — justification required.
// Only APPROVE sets verifiedAt. Optimistic concurrency: the update is
// conditioned on the observed verifiedAt state, so a concurrent reviewer
// decision yields 409 rather than a lost update.
router.post('/:id/decision', REVIEW, wrap(async (req, res) => {
  const { decision, justification } = req.body || {};
  if (!DECISIONS.includes(decision)) return res.status(400).json({ error: `decision must be one of ${DECISIONS.join(', ')}` });
  if (typeof justification !== 'string' || justification.trim().length < 10) {
    return res.status(400).json({ error: 'justification required (min 10 chars)' });
  }
  const p = await prisma.ingredientNutritionProfile.findUnique({ where: { id: req.params.id }, include: { nutrients: true } });
  if (!p) return res.status(404).json({ error: 'not found' });
  const reviewer = actor(req);

  if (decision === 'APPROVE') {
    if (p.verifiedAt) return res.status(409).json({ error: 'already verified — use revoke first' });
    const { count } = await prisma.ingredientNutritionProfile.updateMany({
      where: { id: p.id, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    if (count === 0) return res.status(409).json({ error: 'concurrent decision — state changed, reload' });
  } else {
    // REJECT / REQUEST_CHANGES never verify; they are advisory records only.
    if (!p.verifiedAt && decision === 'REQUEST_CHANGES' && !justification.trim()) {
      return res.status(400).json({ error: 'justification required' });
    }
  }

  audit.log({
    actorId: reviewer,
    action: `nutritionProfile.${decision.toLowerCase().replace('_', '-')}`,
    entityType: 'IngredientNutritionProfile', entityId: p.id,
    beforeData: { verifiedAt: p.verifiedAt },
    afterData: { decision, justification: justification.trim(), sourceDataset: p.sourceDataset, sourceFoodId: p.sourceFoodId },
  }).catch(() => {});
  const profile = await prisma.ingredientNutritionProfile.findUnique({ where: { id: p.id }, include: { nutrients: true } });
  res.json({ profile, decision, decidedBy: reviewer });
}));

// Revoke a previously approved profile — clears verifiedAt; audit-logged.
router.post('/:id/revoke', REVIEW, wrap(async (req, res) => {
  const { justification } = req.body || {};
  if (typeof justification !== 'string' || justification.trim().length < 10) {
    return res.status(400).json({ error: 'justification required (min 10 chars)' });
  }
  const p = await prisma.ingredientNutritionProfile.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!p.verifiedAt) return res.status(409).json({ error: 'profile is not verified' });
  const { count } = await prisma.ingredientNutritionProfile.updateMany({
    where: { id: p.id, verifiedAt: p.verifiedAt },
    data: { verifiedAt: null },
  });
  if (count === 0) return res.status(409).json({ error: 'concurrent decision — state changed, reload' });
  audit.log({
    userId: actor(req), action: 'nutritionProfile.revoke',
    entityType: 'IngredientNutritionProfile', entityId: p.id,
    beforeData: { verifiedAt: p.verifiedAt }, afterData: { verifiedAt: null, justification: justification.trim() },
  }).catch(() => {});
  res.json({ profile: await prisma.ingredientNutritionProfile.findUnique({ where: { id: p.id } }), decision: 'REVOKE' });
}));

module.exports = router;
