const express = require('express');
const { requireRole } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const scheduling = require('../services/schedulingService');

const router = express.Router();
// Mount at /trainer/schedule (see src/routes/index.js mount lines report).
// Flag gate runs before RBAC so a disabled feature answers 403 FEATURE_DISABLED
// for every caller.
router.use(requireFeature('trainer_scheduling_enabled'), requireRole('TRAINER'));

function handle(handler, status = 200) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) res.status(status).json(result);
    } catch (err) {
      const code = err.status || (err.code === 'P2034' ? 409 : 500);
      res.status(code).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
  };
}

// ---------------------------------------------------------------------------
// Weekly availability (replace-all PUT)
// ---------------------------------------------------------------------------

// PUT /trainer/schedule/availability — { windows: [{weekday,startMin,endMin,timeZone?}], timeZone? }
router.put('/availability', handle(async (req) => {
  const { windows, timeZone } = req.body || {};
  return { availability: await scheduling.putAvailability(req.userId, windows, { timeZone }) };
}));

// GET /trainer/schedule/availability — own windows + effective tz
router.get('/availability', handle(async (req) => scheduling.getAvailability(req.userId)));

// ---------------------------------------------------------------------------
// Session types CRUD
// ---------------------------------------------------------------------------

router.post('/session-types', handle(async (req) =>
  scheduling.createSessionType(req.userId, req.body || {}), 201));

router.get('/session-types', handle(async (req) => ({
  sessionTypes: await scheduling.listSessionTypes(req.userId, { includeInactive: true }),
})));

router.patch('/session-types/:id', handle(async (req) =>
  scheduling.updateSessionType(req.userId, req.params.id, req.body || {})));

router.delete('/session-types/:id', handle(async (req) =>
  scheduling.deleteSessionType(req.userId, req.params.id)));

// ---------------------------------------------------------------------------
// Trainer booking management
// ---------------------------------------------------------------------------

// GET /trainer/schedule/bookings?status=&from=
router.get('/bookings', handle(async (req) => ({
  bookings: await scheduling.listForTrainer(req.userId, { status: req.query.status, from: req.query.from }),
})));

// POST /trainer/schedule/bookings/:id/respond — { action: 'confirm'|'decline' }
router.post('/bookings/:id/respond', handle(async (req) =>
  scheduling.respond(req.params.id, req.userId, (req.body || {}).action)));

// POST /trainer/schedule/bookings/:id/cancel — trainer-initiated cancel
router.post('/bookings/:id/cancel', handle(async (req) =>
  scheduling.cancel(req.params.id, req.userId)));

// POST /trainer/schedule/bookings/:id/reschedule — { startAtUtc }
router.post('/bookings/:id/reschedule', handle(async (req) =>
  scheduling.reschedule(req.params.id, req.userId, (req.body || {}).startAtUtc)));

// POST /trainer/schedule/bookings/:id/complete — past confirmed -> completed
router.post('/bookings/:id/complete', handle(async (req) =>
  scheduling.markCompleted(req.userId, req.params.id)));

module.exports = router;
