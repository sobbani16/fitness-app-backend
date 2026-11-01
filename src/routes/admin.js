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
