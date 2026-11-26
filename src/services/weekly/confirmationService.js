const { getPrisma } = require('../../lib/prisma');
const allergens = require('../allergens');

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

/**
 * Re-assess every meal of the day against the user's current allergies before
 * locking (HF-0001 fail-closed). Generation-time checks are not enough: the
 * allergy list may have changed since the plan was built, meals may have been
 * swapped, and recipe composition data evolves. A conflict OR an unknown
 * composition blocks confirmation — the user can still edit the day, but no
 * allergic user may lock in food we cannot vouch for.
 */
async function assertDayAllergenSafe(prisma, planId, dayOfWeek, userId) {
  const user = await allergens.loadUserAllergies(prisma, userId);
  if (!user.keys.length && !user.custom.length) return; // no allergies declared — nothing to enforce
  const meals = await prisma.weeklyMeal.findMany({
    where: { planId, dayOfWeek },
    include: { recipe: { include: { ingredients: true } } },
  });
  const ingredientIds = [];
  for (const m of meals) for (const l of m.recipe?.ingredients || []) if (l.ingredientId) ingredientIds.push(l.ingredientId);
  const info = await allergens.ingredientAllergenInfo(prisma, ingredientIds);
  const blocked = [];
  for (const m of meals) {
    const item = m.recipe
      ? allergens.recipeItem(m.recipe, info)
      : { name: m.foodName, lines: [] }; // ad-hoc entry — no ingredient list → unknown for allergic users
    const r = allergens.assess(item, user);
    if (!allergens.ELIGIBLE(r.status)) {
      blocked.push({ mealType: m.mealType, foodName: m.foodName, status: r.status, conflicts: r.conflicts, unknown: r.unknown.slice(0, 3) });
    }
  }
  if (blocked.length) {
    const err = new Error('This day contains meals that conflict with or cannot be verified against your allergies. Edit the meals before confirming.');
    err.status = 409;
    err.code = 'ALLERGEN_CONFLICT';
    err.blockedMeals = blocked;
    throw err;
  }
}

async function confirmDay(planId, dayOfWeek, userId) {
  const prisma = getPrisma();
  const plan = await prisma.weeklyNutritionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error('Plan not found.');
  if (plan.userId !== userId) throw new Error('Not authorized to confirm this plan.');

  await assertDayAllergenSafe(prisma, planId, dayOfWeek, userId);

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
