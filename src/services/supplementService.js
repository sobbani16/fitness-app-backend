// Supplement catalog service — backed by Postgres via Prisma.
//
// The catalog is a shared table that grows as users add new supplements.
// Users select which supplements they take via the UserSupplement table.
// Only selected supplements appear on their dashboard.

const { getPrisma } = require('../lib/prisma');

async function listSupplements() {
  const prisma = getPrisma();
  return prisma.supplement.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

async function searchSupplements(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const prisma = getPrisma();
  return prisma.supplement.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    take: 20,
  });
}

async function getUserSupplements(userId) {
  if (!userId) throw new Error('userId is required');
  const prisma = getPrisma();
  const rows = await prisma.userSupplement.findMany({
    where: { userId },
    include: { supplement: true },
    orderBy: { supplement: { name: 'asc' } },
  });
  return rows.map((r) => ({
    userSupplementId: r.id,
    lastTakenAt: r.lastTakenAt,
    ...r.supplement,
  }));
}

async function selectSupplement(userId, supplementId) {
  if (!userId) throw new Error('userId is required');
  if (!supplementId) throw new Error('supplementId is required');
  const prisma = getPrisma();
  const link = await prisma.userSupplement.upsert({
    where: { userId_supplementId: { userId, supplementId } },
    update: {},
    create: { userId, supplementId },
    include: { supplement: true },
  });
  return { userSupplementId: link.id, ...link.supplement };
}

async function deselectSupplement(userId, supplementId) {
  if (!userId) throw new Error('userId is required');
  if (!supplementId) throw new Error('supplementId is required');
  const prisma = getPrisma();
  await prisma.userSupplement.deleteMany({
    where: { userId, supplementId },
  });
}

async function addSupplement({
  name, category, brand, flavor,
  defaultDose, servingSizeG,
  calories, proteinG, carbsG, fatG, fiberG,
} = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 100) throw new Error('name too long (max 100 chars)');

  const prisma = getPrisma();
  return prisma.supplement.upsert({
    where: { name: trimmed },
    update: {
      category: category ? String(category).trim() : undefined,
      brand: brand ? String(brand).trim() : undefined,
      flavor: flavor ? String(flavor).trim() : undefined,
      defaultDose: defaultDose ? String(defaultDose).trim() : undefined,
      servingSizeG: servingSizeG != null ? Number(servingSizeG) || null : undefined,
      calories: calories != null ? Number(calories) || 0 : undefined,
      proteinG: proteinG != null ? Number(proteinG) || 0 : undefined,
      carbsG: carbsG != null ? Number(carbsG) || 0 : undefined,
      fatG: fatG != null ? Number(fatG) || 0 : undefined,
      fiberG: fiberG != null ? Number(fiberG) || 0 : undefined,
    },
    create: {
      name: trimmed,
      category: category ? String(category).trim() : null,
      brand: brand ? String(brand).trim() : null,
      flavor: flavor ? String(flavor).trim() : null,
      defaultDose: defaultDose ? String(defaultDose).trim() : null,
      servingSizeG: servingSizeG != null ? Number(servingSizeG) || null : null,
      calories: Number(calories) || 0,
      proteinG: Number(proteinG) || 0,
      carbsG: Number(carbsG) || 0,
      fatG: Number(fatG) || 0,
      fiberG: Number(fiberG) || 0,
      isDefault: false,
    },
  });
}

module.exports = {
  listSupplements,
  searchSupplements,
  addSupplement,
  getUserSupplements,
  selectSupplement,
  deselectSupplement,
};
