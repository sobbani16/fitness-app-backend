// Supplement catalog service — backed by Postgres via Prisma.
//
// The catalog is a shared table. Published + candidate rows are browsable;
// review_only rows are identifiable research records (clearly labeled, never
// suggested); personal rows are visible only to their owner. Users select
// which supplements they take via the UserSupplement table.

const { getPrisma } = require('../lib/prisma');

const BROWSABLE = ['published', 'candidate'];

async function listSupplements({ userId } = {}) {
  const prisma = getPrisma();
  return prisma.supplement.findMany({
    where: {
      OR: [
        { catalogStatus: { in: BROWSABLE } },
        ...(userId ? [{ ownerId: userId }] : []),
      ],
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { ingredient: { select: { slug: true, productionCode: true, evidenceClass: true, researchStatus: true } } },
  });
}

// Search published + candidate + review_only (labeled) + the caller's own
// personal entries. Matches name OR alias.
async function searchSupplements(query, { userId, includeReviewOnly = true } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const prisma = getPrisma();
  const statuses = includeReviewOnly ? [...BROWSABLE, 'review_only'] : BROWSABLE;
  const [byName, byAlias] = await Promise.all([
    prisma.supplement.findMany({
      where: { name: { contains: q, mode: 'insensitive' }, OR: [{ catalogStatus: { in: statuses } }, ...(userId ? [{ ownerId: userId }] : [])] },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      take: 20,
      include: { ingredient: { select: { slug: true, productionCode: true, evidenceClass: true, researchStatus: true } } },
    }),
    prisma.supplement.findMany({
      where: {
        ingredient: { aliases: { some: { normalized: { contains: q.toLowerCase() } } } },
        OR: [{ catalogStatus: { in: statuses } }, ...(userId ? [{ ownerId: userId }] : [])],
      },
      take: 20,
      include: { ingredient: { select: { slug: true, productionCode: true, evidenceClass: true, researchStatus: true } } },
    }),
  ]);
  const seen = new Set(byName.map(s => s.id));
  return [...byName, ...byAlias.filter(s => !seen.has(s.id))].slice(0, 20);
}

async function getUserSupplements(userId) {
  if (!userId) throw new Error('userId is required');
  const prisma = getPrisma();
  const rows = await prisma.userSupplement.findMany({
    where: { userId },
    include: {
      supplement: { include: { ingredient: { select: { slug: true, evidenceClass: true, researchStatus: true } } } },
      schedules: { where: { active: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { supplement: { name: 'asc' } },
  });
  return rows.map((r) => ({
    userSupplementId: r.id,
    lastTakenAt: r.lastTakenAt,
    doseAmount: r.doseAmount,
    doseUnit: r.doseUnit,
    notes: r.notes,
    schedules: r.schedules,
    personalLabel: r.personalLabel,
    ...r.supplement,
    // Prefer the user's own label name when a unique-suffix name was needed.
    name: r.personalLabel?.name || r.supplement.name,
  }));
}

async function selectSupplement(userId, supplementId) {
  if (!userId) throw new Error('userId is required');
  if (!supplementId) throw new Error('supplementId is required');
  const prisma = getPrisma();
  const supplement = await prisma.supplement.findUnique({ where: { id: supplementId } });
  if (!supplement) throw new Error('Supplement not found');
  // Personal rows are only selectable by their owner; archived rows by nobody.
  if (supplement.catalogStatus === 'archived') throw new Error('Supplement is not available');
  if (supplement.ownerId && supplement.ownerId !== userId) throw new Error('Supplement not found');
  const link = await prisma.userSupplement.upsert({
    where: { userId_supplementId: { userId, supplementId } },
    update: {},
    create: {
      userId,
      supplementId,
      ingredientId: supplement.ingredientId,
      formId: supplement.formId,
      productId: supplement.productId,
    },
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

// Personal supplements are owner-scoped and never enter the shared catalog.
// Supplement.name is globally unique, so a collision with another user's
// personal entry (or a catalog row) resolves with a deterministic suffix.
async function addPersonalSupplement(userId, { name, brand, flavor, servingText, doseAmount, doseUnit, notes } = {}) {
  if (!userId) throw new Error('userId is required');
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 100) throw new Error('name too long (max 100 chars)');
  const prisma = getPrisma();
  let supplement = null;
  for (let attempt = 0; attempt < 5 && !supplement; attempt += 1) {
    const candidate = attempt === 0 ? trimmed : `${trimmed} (personal-${attempt}${userId.slice(0, 4)})`;
    try {
      supplement = await prisma.supplement.create({
        data: {
          name: candidate,
          brand: brand ? String(brand).trim() : null,
          flavor: flavor ? String(flavor).trim() : null,
          servingSizeG: null,
          category: 'Personal',
          isDefault: false,
          catalogStatus: 'personal',
          ownerId: userId,
          reviewStatus: 'USER_PROVIDED',
        },
      });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      // Name taken by a catalog row or another user's entry: reuse if it's
      // already this user's own personal supplement, else suffix and retry.
      const existing = await prisma.supplement.findUnique({ where: { name: candidate } });
      if (existing && existing.ownerId === userId && existing.catalogStatus === 'personal') {
        supplement = existing;
      }
    }
  }
  if (!supplement) throw new Error('Could not create personal supplement');
  const link = await prisma.userSupplement.upsert({
    where: { userId_supplementId: { userId, supplementId: supplement.id } },
    update: {},
    create: {
      userId,
      supplementId: supplement.id,
      personalLabel: { name: trimmed, brand: brand || null, flavor: flavor || null, servingText: servingText || null },
      doseAmount: doseAmount != null ? Number(doseAmount) : null,
      doseUnit: doseUnit ? String(doseUnit) : null,
      notes: notes ? String(notes) : null,
    },
    include: { supplement: true },
  });
  return { userSupplementId: link.id, ...link.supplement };
}

// Legacy global-catalog add retained for admin/import tooling. Regular API
// callers should use addPersonalSupplement — user content must not silently
// publish to the shared catalog.
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
      catalogStatus: 'candidate',
    },
  });
}

module.exports = {
  listSupplements,
  searchSupplements,
  addSupplement,
  addPersonalSupplement,
  getUserSupplements,
  selectSupplement,
  deselectSupplement,
};
