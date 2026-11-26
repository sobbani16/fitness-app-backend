const { getPrisma } = require('../../lib/prisma');
const A = require('../allergens');
const { mealItem } = require('../allergyRevalidation');
const { httpError } = require('../../lib/errors');

// Assess every meal of a plan day against the owner's allergen profile —
// the same mealItem/assess semantics PUT /me/allergies uses to revalidate
// active plans, so "unknown" composition is never treated as allergen-safe.
async function allergyGate(prisma, plan, dayOfWeek) {
  const user = await A.loadUserAllergies(prisma, plan.userId);
  if (!user.keys.length && !user.custom.length) return null;
  const meals = await prisma.weeklyMeal.findMany({
    where: { planId: plan.id, dayOfWeek },
    include: { recipe: { include: { ingredients: true } } },
  });
  const info = await A.ingredientAllergenInfo(prisma, meals.flatMap((m) => (m.recipe?.ingredients || []).map((i) => i.ingredientId)));
  const blocked = [];
  for (const m of meals) {
    const r = A.assess(mealItem(m, plan, info), user);
    if (r.status === 'conflict' || r.status === 'unknown') {
      blocked.push({ mealType: m.mealType, foodName: m.foodName, status: r.status, conflicts: r.conflicts, unknown: r.unknown });
    }
  }
  return blocked.length ? blocked : null;
}

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

async function confirmDay(planId, dayOfWeek, userId, { acknowledgeUnknownAllergens = false } = {}) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found.');
  if (plan.userId !== userId) throw new Error('Not authorized to confirm this plan.');

  const blocked = await allergyGate(prisma, plan, dayOfWeek);
  const conflicts = (blocked || []).filter((b) => b.status === 'conflict');
  const unknowns = (blocked || []).filter((b) => b.status === 'unknown');
  if (conflicts.length) {
    throw Object.assign(httpError(409, 'Meals conflict with your recorded allergies.'), { code: 'ALLERGY_CONFLICT', details: { conflicts } });
  }
  if (unknowns.length && !acknowledgeUnknownAllergens) {
    throw Object.assign(httpError(409, 'Some meals have unknown ingredient composition — confirmation requires explicit acknowledgment.'), { code: 'ALLERGY_COMPOSITION_UNKNOWN', details: { unknowns } });
  }

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
