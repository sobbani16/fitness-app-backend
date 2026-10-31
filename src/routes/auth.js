const router = require('express').Router();
const path = require('node:path');
const { ipKeyGenerator } = require('express-rate-limit');
const { getPrisma } = require('../lib/prisma');
const { hashPassword, verifyPassword, createSession, hashToken } = require('../services/authService');
const authenticate = require('../middleware/authenticate');
const { httpError } = require('../lib/errors');
const { GENERIC_MESSAGE, normalizeEmail, validatePassword, enqueueAction, consumeLimit, requestAction, completeAction, actionStatus } = require('../services/authLifecycle');
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
router.get('/action', (req, res) => res.sendFile(path.join(__dirname, '../public/auth-action.html')));
router.get('/action.js', (req, res) => res.sendFile(path.join(__dirname, '../public/auth-action.js')));
router.get('/action.css', (req, res) => res.sendFile(path.join(__dirname, '../public/auth-action.css')));
router.use(async (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    if (!await consumeLimit('auth-ip', ipKeyGenerator(req.ip.replace(/^::ffff:(?=\d+\.)/, '')), 30, 15 * 60000)) {
      res.set('Retry-After', '900'); throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
    }
    next();
  } catch (e) { next(e); }
});
function credentials(body) {
  const email = normalizeEmail(body?.email);
  validatePassword(body?.password);
  return { email, password: body.password };
}
router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = credentials(req.body);
    const passwordHash = await hashPassword(password);
    const session = await getPrisma().$transaction(async tx => {
      const user = await tx.user.create({ data: { email, passwordHash } });
      const role = await tx.role.findUnique({ where: { name: 'MEMBER' } });
      if (!role) throw httpError(503, 'Account setup unavailable. Please try again later.');
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await enqueueAction(tx, user, 'verify-email');
      return createSession(user, tx);
    });
    res.status(201).json(session);
  } catch (e) { next(e.code === 'P2002' ? httpError(409, 'Unable to register this email. Try signing in.') : e); }
});
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = credentials(req.body);
    if (!await consumeLimit('login-email', email, 10, 15 * 60000)) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
    const session = await getPrisma().$transaction(async tx => {
      // Serialize with resets: an old-password login must not create a session after revocation.
      const users = await tx.$queryRaw`SELECT * FROM "User" WHERE "email" = ${email} FOR UPDATE`;
      const user = users[0];
      if (!await verifyPassword(password, user?.passwordHash)) throw httpError(401, 'Invalid email or password.');
      return createSession(user, tx);
    });
    res.json(session);
  } catch (e) { next(e); }
});
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await getPrisma().user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, emailVerifiedAt: true } });
    if (!user) throw httpError(401, 'Sign in required.');
    res.json({ user });
  } catch (e) { next(e); }
});
for (const [route, purpose] of [['forgot-password', 'reset-password'], ['resend-verification', 'verify-email']]) {
  router.post(`/${route}`, async (req, res, next) => {
    try {
      await requestAction(normalizeEmail(req.body?.email), purpose);
      res.status(202).json({ message: GENERIC_MESSAGE });
    } catch (e) { next(e); }
  });
}
for (const purpose of ['verify-email', 'reset-password']) {
  router.post(`/${purpose}`, async (req, res, next) => {
    try {
      await completeAction(req.body?.token, purpose, req.body?.password);
      res.json({ message: purpose === 'verify-email' ? 'Email verified. Return to the app to continue.' : 'Password updated. Sign in with your new password.' });
    } catch (e) { next(e); }
  });
}
// Non-consuming pre-check so the action page can render expired/used links correctly.
router.post('/action-status', async (req, res, next) => {
  try { res.json({ state: await actionStatus(req.body?.token, req.body?.purpose) }); }
  catch (e) { next(e); }
});
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await getPrisma().authSession.deleteMany({ where: { tokenHash: hashToken(req.headers.authorization.slice(7)) } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = router;
