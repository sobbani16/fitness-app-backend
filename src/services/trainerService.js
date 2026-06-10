const { getPrisma } = require('../lib/prisma');

async function listTrainers({ verified, tier } = {}) {
  const prisma = getPrisma();
  const where = { active: true };
  if (verified !== undefined) where.verified = verified;
  if (tier) where.tier = tier;
  return prisma.trainerProfile.findMany({ where, orderBy: { rating: 'desc' } });
}

async function getTrainerByUserId(userId) {
  const prisma = getPrisma();
  return prisma.trainerProfile.findUnique({ where: { userId } });
}

async function getTrainerClients(trainerId) {
  const prisma = getPrisma();
  return prisma.trainerClient.findMany({
    where: { trainerId },
    orderBy: { assignedAt: 'desc' },
  });
}

async function assignClient(trainerId, clientId) {
  const prisma = getPrisma();
  // Check capacity
  const trainer = await prisma.trainerProfile.findUnique({ where: { id: trainerId } });
  if (!trainer) throw new Error('Trainer not found');
  const activeCount = await prisma.trainerClient.count({
    where: { trainerId, status: 'active' },
  });
  if (activeCount >= trainer.maxClients) {
    throw new Error(`Trainer at capacity (${trainer.maxClients} clients max).`);
  }
  return prisma.trainerClient.upsert({
    where: { trainerId_clientId: { trainerId, clientId } },
    update: { status: 'active' },
    create: { trainerId, clientId, status: 'pending' },
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
  getTrainerClients,
  assignClient,
  updateClientStatus,
  createWorkoutPlan,
  getWorkoutPlans,
  getWorkoutPlanById,
};
