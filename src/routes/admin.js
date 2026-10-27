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

// GET /admin/trainers — list all trainer profiles
router.get('/trainers', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const trainers = await prisma.trainerProfile.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ trainers });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/trainers/:id/verify', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try { res.json(await operations.verifyTrainer(req.userId, req.params.id, req.body?.verified)); }
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

module.exports = router;
