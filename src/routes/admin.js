const express = require('express');
const { requireRole, requirePermission } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');
const audit = require('../services/auditService');

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
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/roles/assign — assign a role to a user
router.post('/roles/assign', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { userId, roleName } = req.body || {};
    if (!userId || !roleName) return res.status(400).json({ error: 'userId and roleName required.' });
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return res.status(404).json({ error: `Role "${roleName}" not found.` });

    // Super admin protection: only super admins can assign super admin
    if (roleName === 'SUPER_ADMIN' && !req.userRoles?.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'Only SUPER_ADMIN can assign SUPER_ADMIN role.' });
    }

    const userRole = await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: { active: true },
      create: { userId, roleId: role.id },
    });
    await audit.log({
      actorId: req.userId,
      action: 'role.assign',
      entityType: 'UserRole',
      entityId: userRole.id,
      afterData: { userId, roleName },
    });
    res.status(201).json({ ...userRole, roleName });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /admin/roles/remove — remove a role from a user
router.post('/roles/remove', requirePermission('MANAGE_ROLES'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { userId, roleName } = req.body || {};
    if (!userId || !roleName) return res.status(400).json({ error: 'userId and roleName required.' });
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return res.status(404).json({ error: `Role "${roleName}" not found.` });

    if (roleName === 'SUPER_ADMIN' && !req.userRoles?.includes('SUPER_ADMIN')) {
      return res.status(403).json({ error: 'Only SUPER_ADMIN can remove SUPER_ADMIN role.' });
    }

    await prisma.userRole.updateMany({
      where: { userId, roleId: role.id },
      data: { active: false },
    });
    await audit.log({
      actorId: req.userId,
      action: 'role.remove',
      entityType: 'UserRole',
      afterData: { userId, roleName },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /admin/trainers — list all trainer profiles
router.get('/trainers', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const trainers = await prisma.trainerProfile.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ trainers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /admin/trainers/:id/verify — verify/unverify a trainer
router.patch('/trainers/:id/verify', requirePermission('MANAGE_TRAINERS'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const { verified } = req.body || {};
    const trainer = await prisma.trainerProfile.update({
      where: { id: req.params.id },
      data: { verified: Boolean(verified) },
    });
    await audit.log({
      actorId: req.userId,
      action: 'trainer.verify',
      entityType: 'TrainerProfile',
      entityId: trainer.id,
      afterData: { verified: trainer.verified },
    });
    res.json(trainer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
