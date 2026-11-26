// Grocery list writes — shared by POST /grocery and voice ADD_GROCERY.
// Merge rule: only pending rows with the SAME normalized name AND same unit
// label combine (quantities sum); "2 tomatoes" and "200 g tomatoes" never
// merge without a conversion between the units.
const { getPrisma } = require('../lib/prisma');
const { normalize } = require('./ingredientCsv');

/**
 * @param {string} userId
 * @param {Array<{name:string, amountG?:number|null, unitLabel?:string|null, optional?:boolean, sourceRecipeId?:string}>} items
 * @returns {Promise<{items: object[], merges: Array<{id:string, prev:{amountG:number|null, sourceRecipeId:string|null}}>}>}
 *   `items` — the final row per input (deduped). `merges` — rows that were
 *   updated in place (not created), with their prior state for undo.
 */
async function addItems(userId, items, prisma = getPrisma()) {
  const out = new Map();
  const merges = [];
  for (const it of items) {
    const name = String(it.name || '').trim().slice(0, 200);
    if (!name) continue;
    const normalizedName = normalize(name);
    // `Number(null) === 0` — an absent amount must stay null, never become 0 g.
    const amountG = it.amountG != null && Number.isFinite(Number(it.amountG)) ? Math.max(0, Number(it.amountG)) : null;
    const unitLabel = it.unitLabel ? String(it.unitLabel).slice(0, 40) : null;
    const existing = await prisma.groceryItem.findFirst({ where: { userId, normalizedName, status: 'pending', unitLabel } });
    if (existing) {
      const updated = await prisma.groceryItem.update({
        where: { id: existing.id },
        data: {
          amountG: existing.amountG != null && amountG != null ? existing.amountG + amountG : (amountG ?? existing.amountG),
          sourceRecipeId: existing.sourceRecipeId || it.sourceRecipeId || null,
        },
      });
      merges.push({ id: updated.id, prev: { amountG: existing.amountG, sourceRecipeId: existing.sourceRecipeId } });
      out.set(updated.id, updated);
    } else {
      const created = await prisma.groceryItem.create({
        data: {
          userId, name, normalizedName, amountG,
          unitLabel,
          optional: it.optional === true,
          sourceRecipeId: it.sourceRecipeId ? String(it.sourceRecipeId) : null,
        },
      });
      out.set(created.id, created);
    }
  }
  return { items: [...out.values()], merges };
}

module.exports = { addItems };
