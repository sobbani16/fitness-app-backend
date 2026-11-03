const { randomUUID } = require('node:crypto');
const { API_CONTRACT_VERSION, MIN_CLIENT_CONTRACT } = require('../config/version');

const CORRELATION = /^[A-Za-z0-9._-]{8,64}$/;
const CLIENT_BUILD = /^[A-Za-z0-9._+() -]{1,64}$/;
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+|[A-Za-z0-9_-]{20,})$/i;

// Route template without identifiers or query values, e.g. /food-logs/:id.
function routeLabel(req) {
  if (req.route?.path && typeof req.route.path === 'string') return `${req.baseUrl || ''}${req.route.path}`;
  return (req.originalUrl || req.url || '').split('?')[0].split('/').map(seg => (ID_SEGMENT.test(seg) ? ':id' : seg)).join('/').slice(0, 120);
}

function failureCategory(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 426) return 'upgrade_required';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server';
  return 'validation';
}

/**
 * Correlation ID + privacy-safe failure log. Never records headers, bodies,
 * query values or identifiers — only the route template, status and timing.
 */
function requestContext(logger = console) {
  return (req, res, next) => {
    const incoming = req.headers['x-correlation-id'];
    req.correlationId = typeof incoming === 'string' && CORRELATION.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    res.setHeader('x-api-contract', String(API_CONTRACT_VERSION));
    res.setHeader('x-min-client-contract', String(MIN_CLIENT_CONTRACT));
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (res.statusCode < 400 || process.env.NODE_ENV === 'test') return;
      const build = req.headers['x-client-build'];
      logger.warn(JSON.stringify({
        event: 'api_failure',
        method: req.method,
        route: routeLabel(req),
        status: res.statusCode,
        category: failureCategory(res.statusCode),
        code: res.locals.errorCode || null,
        correlationId: req.correlationId,
        durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
        clientBuild: typeof build === 'string' && CLIENT_BUILD.test(build) ? build : null,
      }));
    });
    // Clients without the header predate contract versioning and stay supported.
    const clientContract = Number(req.headers['x-client-contract']);
    if (Number.isInteger(clientContract) && clientContract < MIN_CLIENT_CONTRACT) {
      res.locals.errorCode = 'CLIENT_UPGRADE_REQUIRED';
      return res.status(426).json({ error: 'Please update the app to continue syncing.', code: 'CLIENT_UPGRADE_REQUIRED', correlationId: req.correlationId });
    }
    next();
  };
}

module.exports = { requestContext, routeLabel, failureCategory };
