const express = require('express');
const { identifyUser } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const scheduling = require('../services/schedulingService');

const router = express.Router();
// Mount at /me → paths resolve to /me/bookings* and /me/available-slots.
// Any authenticated user may act as a client; relation-participation is
// enforced inside the service.
router.use(requireFeature('trainer_scheduling_enabled'), identifyUser);

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

// POST /me/bookings — request a slot { relationId, sessionTypeId, startAtUtc, clientNote? }
router.post('/bookings', handle(async (req) =>
  scheduling.requestBooking(req.userId, req.body || {}), 201));

// GET /me/bookings — caller's bookings (as client)
router.get('/bookings', handle(async (req) => ({
  bookings: await scheduling.listForClient(req.userId),
})));

// POST /me/bookings/:id/cancel — client-side cancel (cancelWindowMin enforced
// on confirmed bookings; requested bookings may be withdrawn anytime)
router.post('/bookings/:id/cancel', handle(async (req) =>
  scheduling.cancel(req.params.id, req.userId)));

// POST /me/bookings/:id/reschedule — { startAtUtc }
router.post('/bookings/:id/reschedule', handle(async (req) =>
  scheduling.reschedule(req.params.id, req.userId, (req.body || {}).startAtUtc)));

// GET /me/available-slots?trainerId=&from=&to=&sessionTypeId=
// Computed bookable slot starts for one session type. Caller must be the
// trainer or share an active relation with them.
router.get('/available-slots', handle(async (req) => {
  const { trainerId, from, to, sessionTypeId } = req.query;
  const slots = await scheduling.availableSlots({ userId: req.userId, trainerId, from, to, sessionTypeId });
  return { slots: slots.map((d) => d.toISOString()) };
}));

module.exports = router;
