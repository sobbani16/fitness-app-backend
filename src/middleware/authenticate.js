const { authenticate } = require('../services/authService');
module.exports = async function authenticateRequest(req, res, next) {
  // Legacy identity is allowed ONLY in isolated unit tests, never in a running server.
  if (process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true') return next();
  try {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
    req.userId = await authenticate(token);
    // Existing handlers consume this header. Always replace untrusted identity.
    req.headers['x-user-id'] = req.userId;
    delete req.query.userId;

    next();
  } catch (error) { next(error); }
};
