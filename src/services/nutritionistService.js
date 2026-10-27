const { getPrisma } = require('../lib/prisma');

async function listNutritionists({ verified } = {}) {
  const prisma = getPrisma();
  const where = { active: true };
  if (verified !== undefined) where.verified = verified;
  return prisma.nutritionistProfile.findMany({ where, orderBy: { createdAt: 'desc' } });
}

async function getNutritionistByUserId(userId) {
  const prisma = getPrisma();
  return prisma.nutritionistProfile.findUnique({ where: { userId } });
}

async function getClients(nutritionistId) {
  const prisma = getPrisma();
  return prisma.nutritionistClient.findMany({
    where: { nutritionistId },
    orderBy: { assignedAt: 'desc' },
  });
}

async function assignClient(nutritionistId, clientId, prisma = getPrisma()) {
  const profile = await prisma.nutritionistProfile.findUnique({ where: { id: nutritionistId } });
  if (!profile) throw new Error('Nutritionist not found');
  const activeCount = await prisma.nutritionistClient.count({
    where: { nutritionistId, status: 'active' },
  });
  if (activeCount >= profile.maxClients) {
    throw new Error(`Nutritionist at capacity (${profile.maxClients} clients max).`);
  }
  return prisma.nutritionistClient.upsert({
    where: { nutritionistId_clientId: { nutritionistId, clientId } },
    update: { status: 'active' },
    create: { nutritionistId, clientId, status: 'pending' },
  });
}

async function createMealPlan(nutritionistId, clientId, { title, caloriesTarget, proteinTarget, carbsTarget, fatTarget, items }, prisma = getPrisma()) {
  if (!await prisma.nutritionistClient.findFirst({where:{nutritionistId,clientId,status:'active'}})) throw new Error('Client not assigned to this nutritionist');
  if (!caloriesTarget || !proteinTarget) throw new Error('caloriesTarget and proteinTarget required');
  const resolvedItems=[];
  if(items != null && (!Array.isArray(items) || items.length>100))throw new Error('At most 100 plan items allowed');
  for(const item of items || []) {
    const quantityG=item.quantityG ?? 100;
    let nutrition={calories:item.calories ?? null,proteinG:item.proteinG ?? null,carbsG:item.carbsG ?? null,fatG:item.fatG ?? null};
    if(item.ingredientId){const result=await require('./ingredientNutrition').calculate(item.ingredientId,{grams:quantityG},prisma);nutrition=Object.fromEntries(Object.keys(nutrition).map(k=>[k,result.nutrition[k]]));}
    resolvedItems.push({mealType:item.mealType||'lunch',foodName:item.foodName,ingredientId:item.ingredientId||null,quantityG,...nutrition});
  }
  return prisma.mealPlan.create({
    data: {
      nutritionistId,
      clientId,
      title: title || null,
      caloriesTarget,
      proteinTarget,
      carbsTarget: carbsTarget || null,
      fatTarget: fatTarget || null,
      items: {
        create: resolvedItems,
      },
    },
    include: { items: true },
  });
}

async function getMealPlans({ nutritionistId, clientId }) {
  const prisma = getPrisma();
  const where = {};
  if (nutritionistId) where.nutritionistId = nutritionistId;
  if (clientId) where.clientId = clientId;
  return prisma.mealPlan.findMany({
    where,
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
}

async function getMealPlanById(id) {
  const prisma = getPrisma();
  return prisma.mealPlan.findUnique({ where: { id }, include: { items: true } });
}

module.exports = {
  listNutritionists,
  getNutritionistByUserId,
  getClients,
  assignClient,
  createMealPlan,
  getMealPlans,
  getMealPlanById,
};
