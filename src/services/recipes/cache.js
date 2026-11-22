// Version-aware in-process cache for SHARED, user-agnostic recipe content.
//
// SAFETY CONTRACT — read before adding a cached entity:
//   1. Only user-agnostic data may be cached (catalog index, static lookups).
//   2. NEVER cache constraints, validation outcomes, generated candidates, or
//      anything derived from a user's profile — those are recomputed per
//      request by loadConstraints + validateGeneratedRecipe.
//   3. Every entry is keyed by a version stamp (count + latest updatedAt);
//      a stamp change invalidates without a TTL wait.
//   4. If the version probe fails, the cache is skipped entirely — a stale
//      read is worse than a slow one.

const TTL_MS = 60_000;
const store = new Map();
const stats = { hits: 0, misses: 0, skips: 0, invalidated: 0 };

async function catalogVersionStamp(prisma) {
  const agg = await prisma.ingredientCatalog.aggregate({
    where: { usable: true },
    _count: { id: true },
    _max: { updatedAt: true },
  });
  return `${agg?._count?.id ?? 0}:${agg?._max?.updatedAt ? +new Date(agg._max.updatedAt) : 0}`;
}

/**
 * @param {object} prisma
 * @param {string} scope — cache namespace ('catalog:validate'|'catalog:match')
 * @param {() => Promise<any>} load — the real query/assembly
 */
async function cachedCatalog(prisma, scope, load) {
  let stamp = null;
  try { stamp = await catalogVersionStamp(prisma); } catch { /* probe unsupported (e.g. partial mocks) */ }
  if (stamp == null) { stats.skips++; return load(); }
  const key = `catalog:${scope}`;
  const hit = store.get(key);
  if (hit) {
    if (hit.stamp === stamp && Date.now() < hit.exp) { stats.hits++; return hit.value; }
    stats.invalidated++;
  }
  stats.misses++;
  const value = await load();
  store.set(key, { stamp, exp: Date.now() + TTL_MS, value });
  return value;
}

function reset() { store.clear(); stats.hits = stats.misses = stats.skips = stats.invalidated = 0; }
function snapshot() { return { ...stats, keys: [...store.keys()] }; }

module.exports = { cachedCatalog, catalogVersionStamp, reset, snapshot };
