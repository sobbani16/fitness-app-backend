// Tester allowlist for pose diagnostics — server-side only.
//
// Grants diagnostics access to (a) ADMIN / SUPER_ADMIN role holders, or
// (b) user IDs in the POSE_DIAGNOSTIC_TESTER_IDS env var (comma-separated).
// No user IDs live in mobile source; the client calls
// GET /pose-coaching/diagnostics-access and caches the verdict briefly.

const { getPrisma } = require('../lib/prisma');

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

async function isPoseDiagnosticsTester(userId) {
  if (!userId) return false;
  const envList = (process.env.POSE_DIAGNOSTIC_TESTER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (envList.includes(userId)) return true;
  const roles = await getPrisma().userRole.findMany({
    where: { userId, active: true },
    include: { role: true },
  });
  return roles.some((ur) => ADMIN_ROLES.has(ur.role?.name));
}

module.exports = { isPoseDiagnosticsTester };
