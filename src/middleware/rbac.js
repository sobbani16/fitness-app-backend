// RBAC Middleware — requireRole() and requirePermission()
// Uses x-user-id header to look up UserRole → Role → RolePermission → Permission.

const { getPrisma } = require('../lib/prisma');

/**
 * Extract userId from request (same pattern used across all routes).
 */
function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

/**
 * Middleware: requires the user to have at least one of the specified roles.
 * Usage: router.get('/path', requireRole('TRAINER', 'ADMIN'), handler)
 */
function requireRole(...roles) {
  return async (req, res, next) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required (x-user-id header missing).' });
    }

    try {
      const prisma = getPrisma();
      const userRoles = await prisma.userRole.findMany({
        where: { userId, active: true },
        include: { role: true },
      });

      const userRoleNames = userRoles.map((ur) => ur.role.name);
      const hasRole = roles.some((r) => userRoleNames.includes(r));

      if (!hasRole) {
        return res.status(403).json({
          error: 'Forbidden — insufficient role.',
          required: roles,
          current: userRoleNames,
        });
      }

      // Attach roles to request for downstream use.
      req.userId = userId;
      req.userRoles = userRoleNames;
      next();
    } catch (err) {
      res.status(500).json({ error: 'RBAC check failed: ' + err.message });
    }
  };
}

/**
 * Middleware: requires the user to have at least one of the specified permissions.
 * Usage: router.get('/path', requirePermission('VIEW_CLIENTS', 'MANAGE_USERS'), handler)
 */
function requirePermission(...permissions) {
  return async (req, res, next) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required (x-user-id header missing).' });
    }

    try {
      const prisma = getPrisma();
      const userRoles = await prisma.userRole.findMany({
        where: { userId, active: true },
        include: {
          role: {
            include: {
              rolePermissions: { include: { permission: true } },
            },
          },
        },
      });

      const userPermissions = new Set();
      for (const ur of userRoles) {
        for (const rp of ur.role.rolePermissions) {
          userPermissions.add(rp.permission.name);
        }
      }

      const hasPermission = permissions.some((p) => userPermissions.has(p));

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden — insufficient permissions.',
          required: permissions,
        });
      }

      req.userId = userId;
      req.userPermissions = [...userPermissions];
      next();
    } catch (err) {
      res.status(500).json({ error: 'Permission check failed: ' + err.message });
    }
  };
}

/**
 * Lightweight middleware: just attach userId (no role check).
 */
function identifyUser(req, res, next) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'x-user-id header required.' });
  }
  req.userId = userId;
  next();
}

module.exports = { requireRole, requirePermission, identifyUser, getUserId };
