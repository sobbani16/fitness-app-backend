// Trainer review HTTP surface — marketplace trust endpoints (pc-HUM-143).
// Role model differs from commerce routes: clients WRITE reviews (verified-
// participant gate lives in the service), authenticated users READ published
// reviews, the reviewed professional RESPONDS, ADMIN moderates. The favorable-
// review prohibition is structural: nothing in the write path conditions
// access, pricing, or visibility on rating content.
const express = require('express');
const { requireRole } = require('../middleware/rbac');
const { requireFeature } = require('../middleware/requireFeature');
const reviews = require('../services/trainerReviewService');

const router = express.Router();
const uid = (req) => req.userId || req.headers['x-user-id'];

// POST /trainer/reviews/:trainerProfileId — upsert (one review per client/trainer
// pair enforced by the compound unique key; repeat submission edits, never duplicates)
router.post('/:trainerProfileId', requireFeature('trainer_paid_coaching_enabled'), async (req, res) => {
  try {
    const review = await reviews.upsertReview(uid(req), req.params.trainerProfileId, req.body || {});
    res.status(201).json(review);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /trainer/reviews/:trainerProfileId — published-only listing
router.get('/:trainerProfileId', async (req, res) => {
  try {
    const items = await reviews.listReviews(req.params.trainerProfileId, { limit: req.query.limit, cursor: req.query.cursor });
    res.json({ reviews: items });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// GET /trainer/reviews/:trainerProfileId/aggregate — discovery-surface aggregate
router.get('/:trainerProfileId/aggregate', async (req, res) => {
  try {
    res.json(await reviews.aggregateReviews(req.params.trainerProfileId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /trainer/reviews/:reviewId/respond — reviewed professional only (enforced in service)
router.post('/:reviewId/respond', requireRole('TRAINER'), async (req, res) => {
  try {
    res.json(await reviews.respondToReview(uid(req), req.params.reviewId, (req.body || {}).body));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// POST /trainer/reviews/:reviewId/moderate — ADMIN only: moderation authority is
// separated from both reviewer and professional (anti-manipulation separation)
router.post('/:reviewId/moderate', requireRole('ADMIN'), async (req, res) => {
  try {
    const { status, flaggedReason } = req.body || {};
    res.json(await reviews.moderateReview(req.params.reviewId, status, flaggedReason));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
