// Trainer marketplace reviews — PHASE-10 trust surface (pc-HUM-143, spec
// docs/programs/professional-marketplace.md @ paperclip 00c50f0).
//
// TRUST MODEL:
//  - Verified participants only: a client may review a trainer only when a
//    real coaching relationship exists (active/terminated relation OR a paid
//    purchase). Eligibility is proven server-side — never client-asserted.
//  - One review per client-trainer pair. Re-submitting edits the existing
//    review (upsert semantics) — duplicates are impossible by construction
//    (@@unique(trainerId, clientId)) not by convention.
//  - Self-review impossible: the trainer's own user account cannot review
//    their own profile even if a fixture relation existed.
//  - Ratings are integers 1-5; `overall` required, axes optional-but-bounded.
//  - Favorable reviews are never required: no minimum rating, no content
//    sentiment gate — any honest rating is publishable.
//  - Moderation is status-based (published/flagged/removed) and separate from
//    the professional's response, which is stored apart and never affects
//    moderation state.
//  - Free-text is optional and length-capped. Review bodies must never carry
//    client health information — the API surface accepts only rating fields +
//    short body (mass-assignment-safe allowlist), and moderation is the human
//    control documented in the verification report.

const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');

const AXES = ['overall', 'quality', 'communication', 'professionalism', 'reliability', 'clarity'];
const BODY_MAX = 2000;
const REVIEW_STATUSES = ['published', 'flagged', 'removed'];

function validateRating(field, value, { required }) {
  if (value === undefined || value === null) {
    if (required) throw httpError(400, `${field} rating is required.`);
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw httpError(400, `${field} must be an integer 1-5.`);
  }
  return value;
}

function validateBody(body) {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'string' || body.length > BODY_MAX) {
    throw httpError(400, `body must be a string of at most ${BODY_MAX} characters.`);
  }
  const trimmed = body.trim();
  return trimmed || null;
}

/** Resolve trainer profile -> { id, userId } or 404. */
async function requireTrainerProfile(prisma, trainerProfileId) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: trainerProfileId } });
  if (!trainer) throw httpError(404, 'Trainer not found.');
  return trainer;
}

/**
 * Verified-participant gate: client must have (a) an active or terminated
 * coaching relation with this trainer, or (b) at least one purchase in `paid`
 * state for one of the trainer's packages. Anything else is not a verified
 * coaching participant and cannot review.
 */
async function assertVerifiedParticipant(prisma, trainer, clientUserId) {
  if (trainer.userId === clientUserId) {
    throw httpError(403, 'Professionals cannot review their own profile.');
  }
  const relation = await prisma.trainerClient.findFirst({
    where: { trainerId: trainer.id, clientId: clientUserId, status: { in: ['active', 'paused', 'completed', 'dropped'] } },
  });
  if (relation) return;
  const purchase = await prisma.trainerPurchase.findFirst({
    where: { clientId: clientUserId, status: { in: ['paid', 'refunded'] }, package: { trainerId: trainer.id } },
  });
  if (!purchase) {
    throw httpError(403, 'Only verified coaching participants can review this professional.');
  }
}

/**
 * Create or edit the caller's review of a trainer. One review per pair —
 * repeat calls edit in place so rating history reflects the client's current
 * honest assessment rather than accumulating duplicates.
 */
async function upsertReview(clientUserId, trainerProfileId, input) {
  const prisma = getPrisma();
  const trainer = await requireTrainerProfile(prisma, trainerProfileId);
  await assertVerifiedParticipant(prisma, trainer, clientUserId);

  const data = {};
  for (const axis of AXES) {
    const value = validateRating(axis, input[axis], { required: axis === 'overall' });
    if (value !== null) data[axis] = value;
  }
  data.body = validateBody(input.body);

  const existing = await prisma.trainerReview.findUnique({
    where: { trainerId_clientId: { trainerId: trainer.id, clientId: clientUserId } },
  });
  if (existing) {
    if (existing.status === 'removed') {
      throw httpError(409, 'This review was removed by moderation and cannot be edited.');
    }
    return prisma.trainerReview.update({ where: { id: existing.id }, data });
  }
  return prisma.trainerReview.create({
    data: { ...data, trainerId: trainer.id, clientId: clientUserId },
  });
}

/**
 * Public listing: published reviews only. Removed/flagged reviews never
 * surface; internal ids beyond the review/trainer pair are not exposed.
 */
async function listReviews(trainerProfileId, { limit = 20, cursor } = {}) {
  const prisma = getPrisma();
  const trainer = await requireTrainerProfile(prisma, trainerProfileId);
  const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return prisma.trainerReview.findMany({
    where: { trainerId: trainer.id, status: 'published' },
    orderBy: { createdAt: 'desc' },
    take,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true, overall: true, quality: true, communication: true,
      professionalism: true, reliability: true, clarity: true,
      body: true, responseBody: true, responseAt: true, createdAt: true, updatedAt: true,
    },
  });
}

/** Aggregate for discovery surfaces — published reviews only. */
async function aggregateReviews(trainerProfileId) {
  const prisma = getPrisma();
  const trainer = await requireTrainerProfile(prisma, trainerProfileId);
  const rows = await prisma.trainerReview.findMany({
    where: { trainerId: trainer.id, status: 'published' },
    select: { overall: true },
  });
  if (!rows.length) return { count: 0, average: null };
  const sum = rows.reduce((acc, row) => acc + row.overall, 0);
  return { count: rows.length, average: Math.round((sum / rows.length) * 100) / 100 };
}

/**
 * Professional response — stored separately from moderation state. Only the
 * reviewed professional may respond; the response never alters status.
 */
async function respondToReview(trainerUserId, reviewId, body) {
  const prisma = getPrisma();
  const review = await prisma.trainerReview.findUnique({ where: { id: reviewId } });
  if (!review) throw httpError(404, 'Review not found.');
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: review.trainerId } });
  if (!trainer || trainer.userId !== trainerUserId) {
    throw httpError(403, 'Only the reviewed professional can respond.');
  }
  const responseBody = validateBody(body);
  if (!responseBody) throw httpError(400, 'response body is required.');
  return prisma.trainerReview.update({
    where: { id: reviewId },
    data: { responseBody, responseAt: new Date() },
  });
}

/**
 * Moderation transition. flaggedReason is mandatory when flagging so the
// moderation trail never contains unexplained state.
 */
async function moderateReview(reviewId, status, flaggedReason) {
  if (!REVIEW_STATUSES.includes(status)) {
    throw httpError(400, `status must be one of ${REVIEW_STATUSES.join(', ')}.`);
  }
  if ((status === 'flagged' || status === 'removed') &&
      (typeof flaggedReason !== 'string' || !flaggedReason.trim())) {
    throw httpError(400, 'flaggedReason is required when flagging or removing a review.');
  }
  const prisma = getPrisma();
  const review = await prisma.trainerReview.findUnique({ where: { id: reviewId } });
  if (!review) throw httpError(404, 'Review not found.');
  return prisma.trainerReview.update({
    where: { id: reviewId },
    data: { status, flaggedReason: status === 'published' ? null : flaggedReason.trim() },
  });
}

module.exports = {
  upsertReview,
  listReviews,
  aggregateReviews,
  respondToReview,
  moderateReview,
  REVIEW_STATUSES,
};
