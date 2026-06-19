const { getPrisma } = require('../../lib/prisma');

async function getDayState(planId, dayOfWeek) {
  const prisma = getPrisma();
  const meals = await prisma.weeklyMeal.findMany({
    where: { planId, dayOfWeek },
    select: { confirmedByUser: true },
  });
  if (!meals.length) return { confirmed: false, allConfirmed: false };
  const confirmed = meals.every((m) => m.confirmedByUser);
  return { confirmed, allConfirmed: confirmed };
}

async function confirmDay(planId, dayOfWeek, userId) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found.');
  if (plan.userId !== userId) throw new Error('Not authorized to confirm this plan.');

  await prisma.weeklyMeal.updateMany({
    where: { planId, dayOfWeek },
    data: { confirmedByUser: true, lockedAt: new Date() },
  });

  return getDayState(planId, dayOfWeek);
}

async function unconfirmDayByTrainer(planId, dayOfWeek, trainerUserId) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found.');

  const relation = await prisma.trainerClient.findFirst({
    where: { clientId: plan.userId, status: 'active' },
  });
  if (!relation || relation.trainerId !== (await getTrainerProfileId(trainerUserId))) {
    throw new Error('Only the assigned trainer can unlock a confirmed day.');
  }

  await prisma.weeklyMeal.updateMany({
    where: { planId, dayOfWeek },
    data: { confirmedByUser: false, lockedAt: null },
  });

  return getDayState(planId, dayOfWeek);
}

async function canEditDay(planId, dayOfWeek, userId) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) return { userCanEdit: false, trainerCanEdit: false, assignedTrainerId: null };

  const dayState = await getDayState(planId, dayOfWeek);
  const isPlanOwner = plan.userId === userId;

  const trainerProfile = await prisma.trainerProfile.findUnique({ where: { userId } });
  let trainerCanEdit = false;
  let assignedTrainerId = null;

  if (trainerProfile) {
    const relation = await prisma.trainerClient.findFirst({
      where: { clientId: plan.userId, status: 'active' },
    });
    if (relation && relation.trainerId === trainerProfile.id) {
      trainerCanEdit = true;
      assignedTrainerId = trainerProfile.id;
    }
  }

  return {
    userCanEdit: isPlanOwner && !dayState.confirmed,
    trainerCanEdit,
    assignedTrainerId,
  };
}

async function getTrainerProfileId(userId) {
  const prisma = getPrisma();
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  return profile?.id || null;
}

async function allDaysConfirmed(planId) {
  for (let day = 0; day < 7; day++) {
    const state = await getDayState(planId, day);
    if (!state.confirmed) return false;
  }
  return true;
}

module.exports = { confirmDay, unconfirmDayByTrainer, canEditDay, getDayState, allDaysConfirmed };
