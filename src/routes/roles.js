const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { getPrisma } = require('../lib/prisma');

const router = express.Router();

// GET /me/roles — returns the current user's roles and permissions
router.get('/', identifyUser, async (req, res) => {
  try {
    if (req.viewAsRole) {
      const { ROLE_PERMISSIONS } = require('../config/rbac');
      return res.json({ userId: req.userId, roles: [req.viewAsRole], permissions: ROLE_PERMISSIONS[req.viewAsRole] || [] });
    }
    const prisma = getPrisma();
    const userRoles = await prisma.userRole.findMany({
      where: { userId: req.userId, active: true },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = new Set();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permissions.add(rp.permission.name);
      }
    }

    res.json({ userId: req.userId, roles, permissions: [...permissions] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
