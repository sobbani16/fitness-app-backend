const { getPrisma } = require('../lib/prisma');
const { CONSENT_CATEGORIES, forbidden } = require('./trainerAccess');
const { normalizeSpecialties, specialtyFilterValues } = require('../config/specialties');
const { certificationNames, syncCertificationEntries } = require('./trainerApplications');
// Interactive transaction clients cannot nest transactions.
const runOperations = (prisma, operations) => prisma.$transaction ? prisma.$transaction(operations) : Promise.all(operations);

const DISCOVERABLE_WHERE = { active: true, verified: true, applicationStatus: 'approved', isDiscoverable: true };
const COACHING_MODES = ['online', 'in_person', 'both'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the first day of next month (UTC midnight). */
function firstDayOfNextMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Days between two dates (floored). */
function daysBetween(a, b) {
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Trainer discovery
// ---------------------------------------------------------------------------

/** Batch-load userIds -> "First Last" display name map (F3: never leak raw ids). */
async function loadDisplayNames(userIds) {
  const prisma = getPrisma();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(users.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim()]));
}

function publicTrainerName(profile, nameMap) {
  return profile.displayName || nameMap.get(profile.userId) || 'Trainer';
}

async function listTrainers({ tier, q, specialty, mode, language, country, cursor, take } = {}) {
  const prisma = getPrisma();
  const where = { ...DISCOVERABLE_WHERE };
  if (tier) where.tier = tier;
  if (specialty) where.specialties = { hasSome: specialtyFilterValues(specialty) };
  if (language) where.languages = { has: language };
  if (country) where.country = { equals: country, mode: 'insensitive' };
  // mode=online|in_person matches trainers offering it directly or 'both';
  // mode=both requires a trainer who explicitly offers both.
  if (mode) {
    if (!COACHING_MODES.includes(mode)) {
      const err = new Error(`Invalid mode: ${mode}`);
      err.status = 400;
      throw err;
    }
    where.coachingMode = mode === 'both' ? 'both' : { in: [mode, 'both'] };
  }
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { location: { contains: q, mode: 'insensitive' } },
    ];
  }

  const limit = Math.min(Math.max(parseInt(take, 10) || 20, 1), 50);
  const rows = await prisma.trainerProfile.findMany({
    where,
    orderBy: [{ rating: 'desc' }, { id: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const trainers = rows.slice(0, limit);
  const nextCursor = hasMore ? trainers[trainers.length - 1].id : null;

  // Batch active-client counts (F8: no N+1) and display names.
  const ids = trainers.map((t) => t.id);
  const [counts, nameMap] = await Promise.all([
    ids.length
      ? prisma.trainerClient.groupBy({
          by: ['trainerId'],
          where: { trainerId: { in: ids }, status: 'active' },
          _count: { _all: true },
        })
      : [],
    loadDisplayNames(trainers.map((t) => t.userId)),
  ]);
  const countMap = new Map(counts.map((c) => [c.trainerId, c._count._all]));

  return {
    trainers: trainers.map((t) => {
      const currentClients = countMap.get(t.id) || 0;
      return {
        ...t,
        displayName: publicTrainerName(t, nameMap),
        currentClients,
        spotsLeft: Math.max(0, t.maxClients - currentClients),
      };
    }),
    nextCursor,
  };
}

async function getTrainerByUserId(userId) {
  const prisma = getPrisma();
  return prisma.trainerProfile.findUnique({ where: { userId } });
}

async function getTrainerById(id) {
  const prisma = getPrisma();
  // F2: only approved, verified, active, discoverable profiles are public.
  const trainer = await prisma.trainerProfile.findFirst({
    where: { id, ...DISCOVERABLE_WHERE },
    include: { certificationsV2: { orderBy: { createdAt: 'desc' } } },
  });
  if (!trainer) return null;
  const [currentClients, nameMap] = await Promise.all([
    prisma.trainerClient.count({ where: { trainerId: id, status: 'active' } }),
    loadDisplayNames([trainer.userId]),
  ]);
  return {
    ...trainer,
    displayName: publicTrainerName(trainer, nameMap),
    currentClients,
    spotsLeft: Math.max(0, trainer.maxClients - currentClients),
  };
}

// ---------------------------------------------------------------------------
// Trainer signup
// ---------------------------------------------------------------------------

const PROFILE_FIELD_ALLOWLIST = [
  'bio', 'certifications', 'specialties', 'yearsExperience', 'tier', 'location',
  'profilePicture', 'displayName', 'languages', 'coachingMode', 'country',
  'timeZone', 'website', 'philosophy', 'isDiscoverable',
];

/** Pick allowlisted profile fields, normalizing specialties to taxonomy ids. */
function pickProfileFields(updates) {
  const data = {};
  for (const key of PROFILE_FIELD_ALLOWLIST) {
    if (updates[key] === undefined) continue;
    if (key === 'specialties') {
      data.specialties = normalizeSpecialties(updates.specialties);
    } else if (key === 'coachingMode') {
      if (!COACHING_MODES.includes(updates.coachingMode)) {
        const err = new Error(`Invalid coachingMode: ${updates.coachingMode}`);
        err.status = 400;
        throw err;
      }
      data.coachingMode = updates.coachingMode;
    } else if (key === 'tier') {
      data.tier = ['standard', 'pro', 'elite'].includes(updates.tier) ? updates.tier : 'standard';
    } else {
      data[key] = updates[key];
    }
  }
  return data;
}

async function createTrainerProfile(userId, updates, prisma = getPrisma()) {
  const existing = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (existing) {
    const err = new Error('Trainer profile already exists for this user.');
    err.status = 409;
    throw err;
  }

  const data = pickProfileFields(updates || {});

  const created = await prisma.trainerProfile.create({
    data: {
      userId,
      bio: data.bio || null,
      certifications: certificationNames(data.certifications),
      specialties: data.specialties || [],
      yearsExperience: data.yearsExperience || 0,
      tier: data.tier || 'standard',
      location: data.location || null,
      profilePicture: data.profilePicture || null,
      displayName: data.displayName || null,
      languages: data.languages || [],
      coachingMode: data.coachingMode || 'both',
      country: data.country || null,
      timeZone: data.timeZone || null,
      website: data.website || null,
      philosophy: data.philosophy || null,
      verified: false,
      active: false, // inactive until admin approves the application
      applicationStatus: 'submitted',
    },
  });
  await syncCertificationEntries(created.id, updates.certifications, prisma);
  return created;
}

async function updateTrainerProfile(userId, updates, prisma = getPrisma()) {
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error('Trainer profile not found.');

  const data = pickProfileFields(updates || {});
  if (data.certifications !== undefined) data.certifications = certificationNames(data.certifications);
  const updated = await prisma.trainerProfile.update({ where: { userId }, data });
  if (updates.certifications !== undefined) await syncCertificationEntries(profile.id, updates.certifications, prisma);
  return updated;
}

// ---------------------------------------------------------------------------
// Client management (trainer-side)
// ---------------------------------------------------------------------------

async function getTrainerClients(trainerId) {
  const prisma = getPrisma();
  const clients = await prisma.trainerClient.findMany({
    where: { trainerId, status: { not: 'dropped' } },
    orderBy: { assignedAt: 'desc' },
    include: { consents: true },
  });
  const nameMap = await loadDisplayNames(clients.map((c) => c.clientId));
  const now = new Date();
  return clients.map((c) => ({
    ...c,
    clientName: nameMap.get(c.clientId) || 'Client',
    grantedCategories: (c.consents || []).filter((x) => x.status === 'granted').map((x) => x.category),
    daysWithTrainer: daysBetween(new Date(c.startedAt), now),
  }));
}

async function assignClient(trainerId, clientId, prisma = getPrisma()) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: trainerId } });
  if (!trainer) throw new Error('Trainer not found');
  if (!trainer.verified || !trainer.active) throw new Error('Trainer is not available.');
  const activeCount = await prisma.trainerClient.count({
    where: { trainerId, status: 'active' },
  });
  if (activeCount >= trainer.maxClients) {
    throw new Error(`Trainer at capacity (${trainer.maxClients} clients max).`);
  }
  const now = new Date();
  const lockedUntil = firstDayOfNextMonth();
  return prisma.trainerClient.upsert({
    where: { trainerId_clientId: { trainerId, clientId } },
    update: { status: 'active', startedAt: now, lockedUntil },
    create: { trainerId, clientId, status: 'active', startedAt: now, lockedUntil },
  });
}

async function updateClientStatus(trainerId, clientId, status, prisma = getPrisma()) {
  const valid = ['pending', 'active', 'paused', 'completed'];
  if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
  return prisma.trainerClient.update({
    where: { trainerId_clientId: { trainerId, clientId } },
    data: { status },
  });
}

// ---------------------------------------------------------------------------
// User → trainer subscription
// ---------------------------------------------------------------------------

/** Create/reset the proposed consent set (all categories pending) for a relation. */
async function provisionPendingConsents(relationId, prisma) {
  for (const category of CONSENT_CATEGORIES) {
    await prisma.trainerClientConsent.upsert({
      where: { relationId_category: { relationId, category } },
      update: { status: 'pending', grantedAt: null, revokedAt: null, policyVersion: 'v1' },
      create: { relationId, category, status: 'pending', policyVersion: 'v1' },
    });
  }
}

/**
 * Client requests a trainer. Creates a `pending` relation + pending consent
 * rows; the relationship only becomes `active` when the trainer accepts via
 * POST /trainer-requests/:id/accept (F5 request→accept flow).
 */
async function subscribeToTrainer(trainerId, clientId, prisma = getPrisma()) {

  // Check if client already has an active trainer
  const existing = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'active' },
    include: { trainer: true },
  });

  const now = new Date();
  if (existing) {
    if (existing.lockedUntil && now < new Date(existing.lockedUntil)) {
      const daysRemaining = daysBetween(now, new Date(existing.lockedUntil));
      const err = new Error('LOCKED');
      err.code = 'TRAINER_LOCKED';
      err.lockedUntil = existing.lockedUntil;
      err.daysRemaining = daysRemaining;
      err.currentTrainerId = existing.trainerId;
      throw err;
    }
    if (existing.trainerId === trainerId) {
      const err = new Error('Already subscribed to this trainer.');
      err.status = 409;
      throw err;
    }
    // Lock expired — mark old as completed before switching
    await prisma.trainerClient.update({
      where: { id: existing.id },
      data: { status: 'completed' },
    });
  }

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: trainerId } });
  if (!trainer || !trainer.verified || !trainer.active || trainer.applicationStatus !== 'approved') {
    const err = new Error('Trainer is not available.');
    err.status = 400;
    throw err;
  }

  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId, clientId } },
  });
  if (relation && relation.status === 'pending') {
    // Idempotent re-request; still ensure the proposed consent set exists.
    if (relation.requestedBy === 'client') {
      await provisionPendingConsents(relation.id, prisma);
      return relation;
    }
    // Trainer invited this client — subscribing is the client's acceptance.
    const activeCount = await prisma.trainerClient.count({
      where: { trainerId, status: 'active' },
    });
    if (activeCount >= trainer.maxClients) {
      const err = new Error(`Trainer at capacity (${trainer.maxClients} clients max).`);
      err.status = 409;
      throw err;
    }
    return prisma.trainerClient.update({
      where: { id: relation.id },
      data: { status: 'active', startedAt: now, lockedUntil: firstDayOfNextMonth() },
    });
  }

  // One outstanding client-initiated request at a time.
  const otherPending = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'pending', requestedBy: 'client', trainerId: { not: trainerId } },
  });
  if (otherPending) {
    const err = new Error('You already have a pending trainer request. Cancel it before requesting another trainer.');
    err.status = 409;
    throw err;
  }

  // Capacity gate: pending + active requests count toward the roster cap.
  const taken = await prisma.trainerClient.count({
    where: { trainerId, status: { in: ['active', 'pending'] } },
  });
  if (taken >= trainer.maxClients) {
    const err = new Error(`Trainer at capacity (${trainer.maxClients} clients max).`);
    err.status = 409;
    throw err;
  }

  const created = await prisma.trainerClient.upsert({
    where: { trainerId_clientId: { trainerId, clientId } },
    update: {
      status: 'pending',
      requestedBy: 'client',
      startedAt: now,
      lockedUntil: null,
      droppedBy: null,
      dropReason: null,
    },
    create: { trainerId, clientId, status: 'pending', requestedBy: 'client', startedAt: now },
  });
  await provisionPendingConsents(created.id, prisma);
  return created;
}

async function getAssignedTrainer(clientId) {
  const prisma = getPrisma();
  const relation = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'active' },
    include: { trainer: true },
  });
  if (!relation) return null;
  const now = new Date();
  const nameMap = await loadDisplayNames([relation.trainer.userId]);
  return {
    ...relation,
    daysWithTrainer: daysBetween(new Date(relation.startedAt), now),
    trainer: {
      ...relation.trainer,
      displayName: publicTrainerName(relation.trainer, nameMap),
      spotsLeft: Math.max(
        0,
        relation.trainer.maxClients -
          (await prisma.trainerClient.count({ where: { trainerId: relation.trainerId, status: 'active' } }))
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Drop flows
// ---------------------------------------------------------------------------

const TRAINER_DROP_REASONS = [
  'non_responsive',
  'goal_mismatch',
  'no_progress',
  'personal_reasons',
  'schedule_conflict',
  'rule_violation',
];

const CLIENT_DROP_REASONS = [
  'not_seeing_results',
  'communication_issues',
  'price',
  'found_better_fit',
  'personal_reasons',
  'schedule_conflict',
];

async function trainerDropClient(trainerUserId, clientId, { reasons, notes, candidateGoals, adherenceRating }, prisma = getPrisma()) {
  const trainerProfile = await prisma.trainerProfile.findUnique({ where: { userId: trainerUserId } });
  if (!trainerProfile) throw new Error('Trainer profile not found.');

  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainerProfile.id, clientId } },
  });
  if (!relation) throw new Error('Client relationship not found.');
  if (relation.status === 'dropped') throw new Error('Already dropped.');

  if (!reasons || reasons.length === 0) throw new Error('At least one reason is required.');

  const [updatedRelation, dropForm] = await runOperations(prisma, [
    prisma.trainerClient.update({
      where: { id: relation.id },
      data: { status: 'dropped', droppedBy: 'trainer', dropReason: JSON.stringify({ reasons, notes }) },
    }),
    prisma.trainerDropForm.create({
      data: {
        relationId: relation.id,
        trainerId: trainerProfile.id,
        clientId,
        droppedBy: 'trainer',
        reasons: reasons || [],
        notes: notes || null,
        candidateGoals: candidateGoals || null,
        adherenceRating: adherenceRating || null,
      },
    }),
  ]);

  return { relation: updatedRelation, dropForm };
}

async function clientDropTrainer(clientId, { reasons, notes, trainerRating }, prisma = getPrisma()) {
  const relation = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'active' },
    include: { trainer: true },
  });
  if (!relation) throw new Error('No active trainer relationship found.');

  const now = new Date();
  if (relation.lockedUntil && now < new Date(relation.lockedUntil)) {
    const daysRemaining = daysBetween(now, new Date(relation.lockedUntil));
    const err = new Error('LOCKED');
    err.code = 'TRAINER_LOCKED';
    err.lockedUntil = relation.lockedUntil;
    err.daysRemaining = daysRemaining;
    throw err;
  }

  if (!reasons || reasons.length === 0) throw new Error('At least one reason is required.');

  const ops = [
    prisma.trainerClient.update({
      where: { id: relation.id },
      data: { status: 'dropped', droppedBy: 'client', dropReason: JSON.stringify({ reasons, notes }) },
    }),
    prisma.trainerDropForm.create({
      data: {
        relationId: relation.id,
        trainerId: relation.trainerId,
        clientId,
        droppedBy: 'client',
        reasons: reasons || [],
        notes: notes || null,
        trainerRating: trainerRating || null,
      },
    }),
  ];

  // Aggregate new trainer rating if provided
  if (trainerRating && trainerRating >= 1 && trainerRating <= 5) {
    const trainer = relation.trainer;
    const newCount = (trainer.ratingCount || 0) + 1;
    const newRating = (((trainer.rating || 0) * (trainer.ratingCount || 0)) + trainerRating) / newCount;
    ops.push(
      prisma.trainerProfile.update({
        where: { id: relation.trainerId },
        data: { rating: parseFloat(newRating.toFixed(2)), ratingCount: newCount },
      })
    );
  }

  const results = await runOperations(prisma, ops);
  return { relation: results[0], dropForm: results[1] };
}

async function getDropFormReasons() {
  return { trainerReasons: TRAINER_DROP_REASONS, clientReasons: CLIENT_DROP_REASONS };
}

// ---------------------------------------------------------------------------
// Progress dashboard (trainer view)
// ---------------------------------------------------------------------------

// Consent category -> response section. Categories with no section
// (food_logs, body_measurements) simply have no query today.
const PROGRESS_CATEGORY_SECTIONS = {
  weight_trends: 'weight',
  nutrition_summaries: 'macroScores',
  workout_records: 'workoutSessions',
  health_scores: 'healthScores',
  step_counts: 'steps',
  sleep_summaries: 'sleep',
};

async function getClientProgress(trainerUserId, clientId, { period = 'weekly', from } = {}) {
  const prisma = getPrisma();
  const trainerProfile = await prisma.trainerProfile.findUnique({ where: { userId: trainerUserId } });
  if (!trainerProfile) throw forbidden('Trainer profile not found.');
  if (!trainerProfile.verified || !trainerProfile.active || trainerProfile.applicationStatus !== 'approved') {
    throw forbidden('Approved trainer status required.');
  }

  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainerProfile.id, clientId } },
  });
  // F1: an existing relation is not enough — dropped/paused/completed
  // relationships no longer grant progress access.
  if (!relation || relation.status !== 'active') throw forbidden('Client not assigned to this trainer.');

  // Determine date range
  const engagementStart = new Date(from || relation.startedAt);
  const now = new Date();
  let rangeStart;

  if (period === 'daily') {
    rangeStart = new Date(now);
    rangeStart.setUTCHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    rangeStart = new Date(now);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - 7);
  } else if (period === 'monthly') {
    rangeStart = new Date(now);
    rangeStart.setUTCMonth(rangeStart.getUTCMonth() - 1);
  } else if (period === '6months') {
    rangeStart = new Date(now);
    rangeStart.setUTCMonth(rangeStart.getUTCMonth() - 6);
  } else {
    rangeStart = engagementStart;
  }

  // Never look before engagement start
  const effectiveStart = rangeStart < engagementStart ? engagementStart : rangeStart;
  const day = effectiveStart.toISOString().slice(0, 10);

  // Consent-gated sections: ungranted categories are omitted entirely.
  const grantedRows = await prisma.trainerClientConsent.findMany({
    where: { relationId: relation.id, status: 'granted' },
    select: { category: true },
  });
  const granted = new Set(grantedRows.map((r) => r.category));
  const has = (category) => granted.has(category);

  const [weightEntries, macroScores, workoutSessions, healthScores, dailySteps, sleepLogs] = await Promise.all([
    has('weight_trends')
      ? prisma.weightEntry.findMany({
          where: { userId: clientId, recordedAt: { gte: effectiveStart } },
          orderBy: { recordedAt: 'asc' },
        })
      : null,
    has('nutrition_summaries')
      ? prisma.dailyMacroScore.findMany({
          where: { userId: clientId, date: { gte: day } },
          orderBy: { date: 'asc' },
        })
      : null,
    has('workout_records')
      ? prisma.workoutSession.findMany({
          where: { userId: clientId, startedAt: { gte: effectiveStart } },
          orderBy: { startedAt: 'asc' },
          include: { exerciseSets: true },
        })
      : null,
    has('health_scores')
      ? prisma.healthScore.findMany({
          where: { userId: clientId, date: { gte: day } },
          orderBy: { date: 'asc' },
          include: { insights: true },
        })
      : null,
    has('step_counts')
      ? prisma.dailySteps.findMany({
          where: { userId: clientId, date: { gte: effectiveStart } },
          orderBy: { date: 'asc' },
        })
      : null,
    has('sleep_summaries')
      ? prisma.sleepLog.findMany({
          where: { userId: clientId, sleepStart: { gte: effectiveStart } },
          orderBy: { sleepStart: 'asc' },
        })
      : null,
  ]);

  const result = {
    period,
    rangeStart: effectiveStart,
    rangeEnd: now,
    engagementStart: relation.startedAt,
    daysWithTrainer: daysBetween(new Date(relation.startedAt), now),
    grantedCategories: [...granted],
  };
  const sectionValues = {
    weight: weightEntries,
    macroScores,
    workoutSessions,
    healthScores,
    steps: dailySteps,
    sleep: sleepLogs,
  };
  for (const [category, key] of Object.entries(PROGRESS_CATEGORY_SECTIONS)) {
    if (granted.has(category)) result[key] = sectionValues[key];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Workout plans (unchanged)
// ---------------------------------------------------------------------------

async function createWorkoutPlan(trainerId, clientId, { title, description, exercises }, prisma = getPrisma()) {
  if (!await prisma.trainerClient.findFirst({where:{trainerId,clientId,status:'active'}})) throw new Error('Client not assigned to this trainer');
  if (!title) throw new Error('title is required');
  return prisma.workoutPlan.create({
    data: {
      trainerId,
      clientId,
      title,
      description: description || null,
      exercises: {
        create: (exercises || []).map((e, i) => ({
          exerciseName: e.exerciseName,
          sets: e.sets || 3,
          reps: e.reps || 10,
          targetWeight: e.targetWeight || null,
          order: i,
        })),
      },
    },
    include: { exercises: true },
  });
}

async function getWorkoutPlans({ trainerId, clientId }) {
  const prisma = getPrisma();
  const where = {};
  if (trainerId) where.trainerId = trainerId;
  if (clientId) where.clientId = clientId;
  return prisma.workoutPlan.findMany({
    where,
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function getWorkoutPlanById(id) {
  const prisma = getPrisma();
  return prisma.workoutPlan.findUnique({
    where: { id },
    include: { exercises: { orderBy: { order: 'asc' } } },
  });
}

module.exports = {
  listTrainers,
  getTrainerByUserId,
  getTrainerById,
  createTrainerProfile,
  updateTrainerProfile,
  loadDisplayNames,
  publicTrainerName,
  provisionPendingConsents,
  getTrainerClients,
  assignClient,
  updateClientStatus,
  subscribeToTrainer,
  getAssignedTrainer,
  trainerDropClient,
  clientDropTrainer,
  getDropFormReasons,
  getClientProgress,
  createWorkoutPlan,
  getWorkoutPlans,
  getWorkoutPlanById,
};
