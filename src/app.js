const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const helmet = require('helmet');
const { requestContext } = require('./middleware/requestContext');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet());
app.use(requestContext());
const origins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)) }));
app.use(express.json({ limit: '8mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan(':method :url :status :response-time ms', { skip: req => req.path.startsWith('/auth') || req.path.startsWith('/me/account') || req.path.startsWith('/me/legacy-migration') }));
app.use('/health', require('./routes/health'));
// Public payment webhooks — signature-verified, no session auth (provider HMAC only).
app.use('/webhooks/payments', require('./routes/paymentWebhooks'));
const rateLimited = (req, res) => { res.locals.errorCode = 'RATE_LIMITED'; res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.', code: 'RATE_LIMITED', correlationId: req.correlationId }); };
const limiterBase = { windowMs: 60000, skip: () => process.env.NODE_ENV === 'test', standardHeaders: 'draft-7', legacyHeaders: false, handler: rateLimited };
// Per-address ceiling for anonymous traffic. Behind a proxy this is only a real
// client address when TRUST_PROXY_HOPS is set; otherwise it is the edge node.
app.use(rateLimit({ ...limiterBase, limit: Number(process.env.API_IP_RATE_LIMIT || 600) }));
app.use('/auth', require('./routes/auth'));
app.use(require('./middleware/authenticate'));
// Per-account budget, keyed on the authenticated identity (the admin during view-as).
app.use(rateLimit({ ...limiterBase, limit: Number(process.env.API_RATE_LIMIT || 120), identifier: 'user', keyGenerator: req => `user:${req.viewAs?.adminId || req.userId}` }));
app.use('/me/account', require('./routes/account'));
app.use(require('./middleware/requireVerifiedEmail'));
app.use('/me/legacy-migration', require('./routes/legacyMigration'));
if (process.env.ENABLE_API_DOCS === 'true') require('./swagger').setupSwagger(app);
if (process.env.NODE_ENV === 'test' && process.env.AUTH_TEST_BYPASS === 'true') app.use(require('./middleware/ensureUser').ensureUser);
app.use(require('./middleware/validateInput'));
app.use('/me/progress', require('./routes/progress'));
app.use('/me/profile', require('./routes/profile'));
// myPurchases is mounted in routes/index.js AFTER the other /me mounts —
// its router-level paid-coaching flag must not shadow /me/roles, plans, etc.
app.use('/trainer/commerce', require('./routes/trainerCommerce'));
app.use('/config', require('./routes/config'));
app.use('/', require('./routes'));
app.use((req,res) => { res.locals.errorCode = 'NOT_FOUND'; res.status(404).json({error:'Not found', code:'NOT_FOUND', correlationId: req.correlationId}); });
app.use((err,req,res,next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  const code = err.body?.code || err.publicCode || (status >= 500 ? 'INTERNAL' : status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST');
  res.locals.errorCode = code;
  if (status >= 500) console.error('Request failed', { path:req.path, code:err.code || err.name, correlationId: req.correlationId });
  if (err.body) return res.status(status).json({ ...err.body, correlationId: req.correlationId });
  res.status(status).json({error:status >= 500 && !err.status ? 'Service unavailable. Please try again.' : err.message, code, correlationId: req.correlationId});
});
module.exports = app;
