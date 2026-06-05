// Supplement catalog service — backed by Postgres via Prisma.
//
// The catalog is a shared table that grows as users add new supplements.
// `listSupplements` returns the full catalog; `addSupplement` inserts a new
// row (idempotent by name via upsert) so the data table updates whenever a
// user adds one that doesn't exist yet.

const { getPrisma } = require('../lib/prisma');

async function listSupplements() {
  const prisma = getPrisma();
  return prisma.supplement.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

async function addSupplement({ name, category, defaultDose } = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60 chars)');

  const prisma = getPrisma();
  return prisma.supplement.upsert({
    where: { name: trimmed },
    update: {
      category: category ? String(category).trim() : undefined,
      defaultDose: defaultDose ? String(defaultDose).trim() : undefined,
    },
    create: {
      name: trimmed,
      category: category ? String(category).trim() : null,
      defaultDose: defaultDose ? String(defaultDose).trim() : null,
      isDefault: false,
    },
  });
}

module.exports = { listSupplements, addSupplement };
