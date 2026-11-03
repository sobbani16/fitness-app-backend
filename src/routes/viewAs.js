const express = require('express');
const { requirePermission } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');
const { ROLE_PERMISSIONS } = require('../config/rbac');
const { issueViewAsToken } = require('../services/viewAsService');
const audit = require('../services/auditService');
function fail(res, err) { return res.status(err.status || 500).json({ error: err.status ? err.message : 'Administrator operation failed.' }); }

const router = express.Router();

// POST /admin/view-as { userId?, role? } — issue a 30-min read-only preview token.
router.post('/', requirePermission('SUPER_ADMIN_PANEL'), async (req, res) => {
  try {
    const { userId, role } = req.body || {};
    if (!userId && !role) { const e = new Error('Provide userId or role.'); e.status = 400; throw e; }
    let subject = null;
    if (userId) {
      subject = await getPrisma().user.findUnique({ where: { id: String(userId) }, select: { id: true, email: true, firstName: true, lastName: true } });
      if (!subject) { const e = new Error('User not found.'); e.status = 404; throw e; }
    }
    if (role && !ROLE_PERMISSIONS[role]) { const e = new Error('Unknown role.'); e.status = 400; throw e; }
    const { token, expiresAt } = issueViewAsToken({ adminId: req.userId, userId, role });
    await audit.log({
      actorId: req.userId, action: 'admin.view_as.issue',
      entityType: userId ? 'User' : 'Role', entityId: String(userId || role),
      afterData: { userId: userId || null, role: role || null, expiresAt },
    });
    res.status(201).json({ token, expiresAt, subject: { userId: userId || null, role: role || null, email: subject?.email || null, name: subject ? [subject.firstName, subject.lastName].filter(Boolean).join(' ') || null : null } });
  } catch (err) { fail(res, err); }
});

// GET /admin/view-as/users?q= — search users for the picker (id, email, name, roles).
router.get('/users', requirePermission('SUPER_ADMIN_PANEL'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const where = q
      ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }] }
      : {};
    const users = await getPrisma().user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        userRoles: { where: { active: true }, select: { role: { select: { name: true } } } },
        trainerProfile: { select: { applicationStatus: true } },
      },
    });
    res.json({
      users: users.map(u => ({
        id: u.id, email: u.email,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
        roles: u.userRoles.map(r => r.role.name),
        trainerStatus: u.trainerProfile?.applicationStatus || null,
      })),
    });
  } catch (err) { fail(res, err); }
});

module.exports = router;
