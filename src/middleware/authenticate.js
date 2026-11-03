const { authenticate } = require('../services/authService');
const { verifyViewAsToken, isSuperAdmin } = require('../services/viewAsService');
module.exports = async function authenticateRequest(req, res, next) {
  // Legacy identity is allowed ONLY in isolated unit tests, never in a running server.
  if (process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true') return next();
  try {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
    req.userId = await authenticate(token);
    // Existing handlers consume this header. Always replace untrusted identity.
    req.headers['x-user-id'] = req.userId;
    delete req.query.userId;

    // View-as preview: SUPER_ADMIN-only, signed token, read-only.
    const viewAsToken = req.headers['x-view-as'];
    if (viewAsToken) {
      const claims = verifyViewAsToken(viewAsToken);
      if (claims.aid !== req.userId || !(await isSuperAdmin(req.userId))) {
        return res.status(403).json({ error: 'View-as requires an active super-admin session.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(403).json({ error: 'View-as sessions are read-only.' });
      }
      if (claims.uid) {
        req.headers['x-user-id'] = claims.uid;
        req.userId = claims.uid;
      }
      if (claims.role) req.viewAsRole = claims.role;
      req.viewAs = { adminId: claims.aid, userId: claims.uid || null, role: claims.role || null };
      res.setHeader('x-view-as', 'active');
    }

    next();
  } catch (error) { next(error); }
};
