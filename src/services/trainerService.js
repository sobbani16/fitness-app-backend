const { getPrisma } = require('../lib/prisma');

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

async function listTrainers({ verified, tier } = {}) {
  const prisma = getPrisma();
  const where = { active: true };
  if (verified !== undefined) where.verified = verified;
  if (tier) where.tier = tier;
  const trainers = await prisma.trainerProfile.findMany({
    where,
    orderBy: { rating: 'desc' },
  });
  // Attach current client count for "X spots left"
  return Promise.all(
    trainers.map(async (t) => {
      const currentClients = await prisma.trainerClient.count({
        where: { trainerId: t.id, status: 'active' },
      });
      return { ...t, currentClients, spotsLeft: Math.max(0, t.maxClients - currentClients) };
    })
  );
}

async function getTrainerByUserId(userId) {
  const prisma = getPrisma();
  return prisma.trainerProfile.findUnique({ where: { userId } });
}

async function getTrainerById(id) {
  const prisma = getPrisma();
  const trainer = await prisma.trainerProfile.findUnique({ where: { id } });
  if (!trainer) return null;
  const currentClients = await prisma.trainerClient.count({
    where: { trainerId: id, status: 'active' },
  });
  return { ...trainer, currentClients, spotsLeft: Math.max(0, trainer.maxClients - currentClients) };
}

// ---------------------------------------------------------------------------
// Trainer signup
// ---------------------------------------------------------------------------

async function createTrainerProfile(userId, { bio, certifications, specialties, yearsExperience, tier, location, profilePicture }) {
  const prisma = getPrisma();
  const existing = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (existing) throw new Error('Trainer profile already exists for this user.');

  const tierRates = { standard: 30, pro: 50, elite: 100 };
  const resolvedTier = tier && tierRates[tier] ? tier : 'standard';

  return prisma.trainerProfile.create({
    data: {
      userId,
      bio: bio || null,
      certifications: certifications || [],
      specialties: specialties || [],
      yearsExperience: yearsExperience || 0,
      tier: resolvedTier,
      monthlyRateUsd: tierRates[resolvedTier],
      location: location || null,
      profilePicture: profilePicture || null,
      verified: false,
      active: false, // inactive until admin verifies
    },
  });
}

async function updateTrainerProfile(userId, updates) {
  const prisma = getPrisma();
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error('Trainer profile not found.');

  const allowed = ['bio', 'certifications', 'specialties', 'yearsExperience', 'location', 'profilePicture'];
  const data = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }
  return prisma.trainerProfile.update({ where: { userId }, data });
}

// ---------------------------------------------------------------------------
// Client management (trainer-side)
// ---------------------------------------------------------------------------

async function getTrainerClients(trainerId) {
  const prisma = getPrisma();
  const clients = await prisma.trainerClient.findMany({
    where: { trainerId, status: { not: 'dropped' } },
    orderBy: { assignedAt: 'desc' },
  });
  const now = new Date();
  return clients.map((c) => ({
    ...c,
    daysWithTrainer: daysBetween(new Date(c.startedAt), now),
  }));
}

async function assignClient(trainerId, clientId) {
  const prisma = getPrisma();
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

async function updateClientStatus(trainerId, clientId, status) {
  const prisma = getPrisma();
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

async function subscribeToTrainer(trainerId, clientId) {
  const prisma = getPrisma();

  // Check if client already has an active trainer
  const existing = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'active' },
    include: { trainer: true },
  });

  if (existing) {
    const now = new Date();
    if (existing.lockedUntil && now < new Date(existing.lockedUntil)) {
      const daysRemaining = daysBetween(now, new Date(existing.lockedUntil));
      const err = new Error('LOCKED');
      err.code = 'TRAINER_LOCKED';
      err.lockedUntil = existing.lockedUntil;
      err.daysRemaining = daysRemaining;
      err.currentTrainerId = existing.trainerId;
      throw err;
    }
    // Lock expired — mark old as completed before switching
    await prisma.trainerClient.update({
      where: { id: existing.id },
      data: { status: 'completed' },
    });
  }

  return assignClient(trainerId, clientId);
}

async function getAssignedTrainer(clientId) {
  const prisma = getPrisma();
  const relation = await prisma.trainerClient.findFirst({
    where: { clientId, status: 'active' },
    include: { trainer: true },
  });
  if (!relation) return null;
  const now = new Date();
  return {
    ...relation,
    daysWithTrainer: daysBetween(new Date(relation.startedAt), now),
    trainer: {
      ...relation.trainer,
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

async function trainerDropClient(trainerUserId, clientId, { reasons, notes, candidateGoals, adherenceRating }) {
  const prisma = getPrisma();
  const trainerProfile = await prisma.trainerProfile.findUnique({ where: { userId: trainerUserId } });
  if (!trainerProfile) throw new Error('Trainer profile not found.');

  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainerProfile.id, clientId } },
  });
  if (!relation) throw new Error('Client relationship not found.');
  if (relation.status === 'dropped') throw new Error('Already dropped.');

  if (!reasons || reasons.length === 0) throw new Error('At least one reason is required.');

  const [updatedRelation, dropForm] = await prisma.$transaction([
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

async function clientDropTrainer(clientId, { reasons, notes, trainerRating }) {
  const prisma = getPrisma();
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

  const results = await prisma.$transaction(ops);
  return { relation: results[0], dropForm: results[1] };
}

async function getDropFormReasons() {
  return { trainerReasons: TRAINER_DROP_REASONS, clientReasons: CLIENT_DROP_REASONS };
}

// ---------------------------------------------------------------------------
// Progress dashboard (trainer view)
// ---------------------------------------------------------------------------

async function getClientProgress(trainerUserId, clientId, { period = 'weekly', from } = {}) {
  const prisma = getPrisma();
  const trainerProfile = await prisma.trainerProfile.findUnique({ where: { userId: trainerUserId } });
  if (!trainerProfile) throw new Error('Trainer profile not found.');

  const relation = await prisma.trainerClient.findUnique({
    where: { trainerId_clientId: { trainerId: trainerProfile.id, clientId } },
  });
  if (!relation) throw new Error('Client not assigned to this trainer.');

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

  const [weightEntries, macroScores, workoutSessions, healthScores, dailySteps, sleepLogs] = await Promise.all([
    prisma.weightEntry.findMany({
      where: { userId: clientId, recordedAt: { gte: effectiveStart } },
      orderBy: { recordedAt: 'asc' },
    }),
    prisma.dailyMacroScore.findMany({
      where: { userId: clientId, date: { gte: effectiveStart.toISOString().slice(0, 10) } },
      orderBy: { date: 'asc' },
    }),
    prisma.workoutSession.findMany({
      where: { userId: clientId, startedAt: { gte: effectiveStart } },
      orderBy: { startedAt: 'asc' },
      include: { exerciseSets: true },
    }),
    prisma.healthScore.findMany({
      where: { userId: clientId, date: { gte: effectiveStart.toISOString().slice(0, 10) } },
      orderBy: { date: 'asc' },
      include: { insights: true },
    }),
    prisma.dailySteps.findMany({
      where: { userId: clientId, date: { gte: effectiveStart } },
      orderBy: { date: 'asc' },
    }),
    prisma.sleepLog.findMany({
      where: { userId: clientId, sleepStart: { gte: effectiveStart } },
      orderBy: { sleepStart: 'asc' },
    }),
  ]);

  return {
    period,
    rangeStart: effectiveStart,
    rangeEnd: now,
    engagementStart: relation.startedAt,
    daysWithTrainer: daysBetween(new Date(relation.startedAt), now),
    weight: weightEntries,
    macroScores,
    workoutSessions,
    healthScores,
    steps: dailySteps,
    sleep: sleepLogs,
  };
}

// ---------------------------------------------------------------------------
// Workout plans (unchanged)
// ---------------------------------------------------------------------------

async function createWorkoutPlan(trainerId, clientId, { title, description, exercises }) {
  if (!title) throw new Error('title is required');
  const prisma = getPrisma();
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
