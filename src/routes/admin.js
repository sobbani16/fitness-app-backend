const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');
const operations = require('../services/adminOperations');
function fail(res, err) { return res.status(err.status || 500).json({ error: err.status ? err.message : 'Administrator operation failed.' }); }

const router = express.Router();

// GET /admin/users — list users with roles
router.get('/users', requirePermission('MANAGE_USERS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const users = await prisma.userRole.findMany({
      include: { role: true },
      orderBy: { assignedAt: 'desc' },
      take: 100,
    });
    // Group by userId
    const grouped = {};
    for (const ur of users) {
      if (!grouped[ur.userId]) grouped[ur.userId] = { userId: ur.userId, roles: [] };
      grouped[ur.userId].roles.push({ role: ur.role.name, active: ur.active, assignedAt: ur.assignedAt });
    }
    res.json({ users: Object.values(grouped) });
  } catch (err) {
    fail(res, err);
  }
});

for (const [operation, active] of [['assign', true], ['remove', false]]) {
  router.post(`/roles/${operation}`, requirePermission('MANAGE_ROLES'), async (req, res) => {
    try {
      const result = await operations.changeRole(req.userId, req.body, active);
      res.status(active ? 201 : 200).json(active ? result : { ok: true });
    } catch (err) { fail(res, err); }
  });
}

// GET /admin/trainers — list trainer profiles (?applicationStatus= filter;
// rows include applicationStatus/applicationNote/approvedAt fields)
router.get('/trainers', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const where = {};
    if (req.query.applicationStatus) where.applicationStatus = req.query.applicationStatus;
    const trainers = await prisma.trainerProfile.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ trainers });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/trainers/:id/verify', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try { res.json(await operations.verifyTrainer(req.userId, req.params.id, req.body?.verified)); }
  catch (err) { fail(res, err); }
});

// PATCH /admin/trainers/:id/review — application review decision
// {decision:'approve'|'reject'|'request_changes', note?}
router.patch('/trainers/:id/review', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try { res.json(await operations.reviewTrainer(req.userId, req.params.id, req.body || {})); }
  catch (err) { fail(res, err); }
});

// GET /admin/analytics — platform stats
router.get('/analytics', requirePermission('VIEW_PLATFORM_ANALYTICS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const [userCount, trainerCount, nutritionistCount, planCount, mealPlanCount] = await Promise.all([
      prisma.userRole.count({ where: { active: true } }),
      prisma.trainerProfile.count({ where: { active: true } }),
      prisma.nutritionistProfile.count({ where: { active: true } }),
      prisma.workoutPlan.count(),
      prisma.mealPlan.count(),
    ]);
    res.json({ users: userCount, trainers: trainerCount, nutritionists: nutritionistCount, workoutPlans: planCount, mealPlans: mealPlanCount });
  } catch (err) {
    fail(res, err);
  }
});

// GET /admin/feature-flags — registry + provider diagnostics (read-only).
// Runtime overrides are managed in PostHog / env vars by design; this view
// exists so reviewers can see flag state without console access.
// GET /admin/recipe-intelligence/metrics — privacy-conscious counters only.
router.get('/recipe-intelligence/metrics', requirePermission('VIEW_PLATFORM_ANALYTICS'), async (req, res) => {
  try {
    res.json({ ...require('../services/recipes/metrics').snapshot(), cache: require('../services/recipes/cache').snapshot() });
  } catch (err) { fail(res, err); }
});

// GET /admin/recipe-intelligence/validation-log — recent validation decisions
// (status/ruleIds/versions; no health data or ingredient payloads).
router.get('/recipe-intelligence/validation-log', requirePermission('VIEW_PLATFORM_ANALYTICS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const rows = await prisma.safetyAuditLog.findMany({
      where: { checkType: 'recipe_validation' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, Number(req.query.take) || 50)),
      select: { id: true, userId: true, input: true, result: true, passed: true, createdAt: true },
    });
    res.json({ rows });
  } catch (err) { fail(res, err); }
});

// ---- Clinical rule review workflow ---------------------------------------
// Mechanical transition endpoint for ConditionRule / HealthConditionNutrientRule
// reviewStatus (DRAFT → REVIEWED → APPROVED). ACADEMY_CLINICAL_REVIEW gates it;
// approval is additionally blocked when the rule lacks evidence or required
// fields. The endpoint cannot and does not confer clinical legitimacy — the
// attestation + reviewer identity are recorded for accountability.

function ruleGaps(rule, kind) {
  const gaps = [];
  if (!rule.evidenceSourceId && !rule.evidence) gaps.push('no_evidence_source');
  if (kind === 'nutrient' && ['LIMIT', 'AVOID_IF_INDICATED'].includes(rule.action) && rule.thresholdValue == null) {
    gaps.push('limit_without_threshold');
  }
  return gaps;
}

// GET /admin/clinical-rules — review queue with per-rule blocking gaps.
router.get('/clinical-rules', requirePermission('VIEW_PLATFORM_ANALYTICS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const [cond, nut] = await Promise.all([
      prisma.conditionRule.findMany({
        include: {
          condition: { select: { name: true } },
          evidence: { select: { organization: true, guidelineTitle: true, publicationYear: true, lastReviewedAt: true, evidenceNotes: true } },
        },
      }),
      prisma.healthConditionNutrientRule.findMany({
        include: {
          healthCondition: { select: { name: true } },
          nutrient: { select: { name: true, unit: true } },
          evidence: { select: { organization: true, guidelineTitle: true, publicationYear: true, lastReviewedAt: true, evidenceNotes: true } },
        },
      }),
    ]);
    res.json({
      conditionRules: cond.map((r) => ({
        id: r.id, type: 'condition', condition: r.condition?.name, attribute: r.attribute,
        target: r.target, action: r.action, reason: r.reason,
        reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt,
        requiresPersonalization: r.requiresPersonalization,
        evidence: r.evidence || null, gaps: ruleGaps(r, 'condition'),
      })),
      nutrientRules: nut.map((r) => ({
        id: r.id, type: 'nutrient', code: r.code, condition: r.healthCondition?.name,
        nutrient: r.nutrient?.name, action: r.action, severity: r.severity,
        thresholdValue: r.thresholdValue, thresholdUnit: r.thresholdUnit, thresholdBasis: r.thresholdBasis,
        rationale: r.rationale, reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt, requiresPersonalization: r.requiresPersonalization,
        evidence: r.evidence || null, gaps: ruleGaps(r, 'nutrient'),
      })),
    });
  } catch (err) { fail(res, err); }
});

// POST /admin/clinical-rules/transition — {type, id, to, attestation}
// APPROVED requires a >=20-char attestation and zero blocking gaps.
router.post('/clinical-rules/transition', requirePermission('ACADEMY_CLINICAL_REVIEW'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { type, id, to, attestation } = req.body || {};
    if (!['condition', 'nutrient'].includes(type)) return res.status(400).json({ error: 'type: condition|nutrient required.' });
    if (!['DRAFT', 'REVIEWED', 'APPROVED'].includes(to)) return res.status(400).json({ error: 'to: DRAFT|REVIEWED|APPROVED required.' });
    if (!id) return res.status(400).json({ error: 'id required.' });
    const attest = String(attestation || '').trim();

    const model = type === 'condition' ? prisma.conditionRule : prisma.healthConditionNutrientRule;
    const rule = await model.findUnique({ where: { id }, include: type === 'condition' ? { evidence: true } : { evidence: true } });
    if (!rule) return res.status(404).json({ error: 'Rule not found.' });

    if (to === 'APPROVED') {
      if (attest.length < 20) {
        return res.status(422).json({ error: 'Approval requires a >=20-char attestation documenting the reviewer\'s clinical basis.' });
      }
      const gaps = ruleGaps(rule, type);
      if (gaps.length) return res.status(422).json({ error: 'Rule has blocking gaps — resolve before approval.', gaps });
    }

    // Same from-state rules as the governed workflow: approval only after
    // review, review only from draft/in-review. Demotion to DRAFT is always
    // allowed (moving a rule away from live is the safe direction).
    const ALLOWED_FROM = { APPROVED: ['REVIEWED', 'IN_REVIEW'], REVIEWED: ['IN_REVIEW', 'DRAFT'], DRAFT: ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED'] };
    if (!ALLOWED_FROM[to].includes(rule.reviewStatus)) {
      return res.status(409).json({ error: `Cannot move a rule in ${rule.reviewStatus} to ${to} via this endpoint — use the governed transition workflow.` });
    }

    // Status change + immutable ClinicalRuleEvent + safetyAuditLog commit
    // atomically — a crash between them would be a silent governance action.
    const ruleTable = type === 'condition' ? 'conditionRule' : 'healthConditionNutrientRule';
    const action = to === 'APPROVED' ? 'approve' : to === 'REVIEWED' ? 'review' : 'submit';
    const [updated] = await prisma.$transaction((tx) => Promise.all([
      tx[ruleTable].update({
        where: { id },
        data: { reviewStatus: to, reviewedBy: req.userId, reviewedAt: new Date(), version: { increment: 1 } },
      }),
      tx.clinicalRuleEvent.create({
        data: {
          ruleTable, ruleId: id, ruleCode: rule[ruleTable === 'conditionRule' ? 'ruleCode' : 'code'] || null,
          fromStatus: rule.reviewStatus, toStatus: to, action,
          actorId: req.userId, actorRole: (req.userRoles || []).join(',') || null,
          notes: attest ? attest.slice(0, 500) : null,
          diff: { reviewStatus: [rule.reviewStatus, to] },
        },
      }),
      tx.safetyAuditLog.create({
        data: {
          userId: req.userId, checkType: 'clinical_rule_review',
          input: { type, id, to, attestation: attest.slice(0, 500) },
          result: { status: 'ok', from: rule.reviewStatus, to },
          passed: true,
        },
      }),
    ]));
    res.json({ id: updated.id, reviewStatus: updated.reviewStatus, reviewedBy: updated.reviewedBy, reviewedAt: updated.reviewedAt, version: updated.version });
  } catch (err) { fail(res, err); }
});

router.get('/feature-flags', requirePermission('MANAGE_FEATURE_FLAGS'), async (req, res) => {
  try {
    const { FEATURES } = require('../config/featureRegistry');
    const flags = require('../services/featureFlags/service');
    res.json({
      registry: Object.entries(FEATURES).map(([key, f]) => ({
        key, clientKey: f.clientKey, class: f.class, group: f.group,
        default: f.default, endpoints: f.endpoints, description: f.description,
      })),
      diagnostics: flags.diagnostics(),
      resolvedForCaller: await flags.evaluateAll(req.userId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
