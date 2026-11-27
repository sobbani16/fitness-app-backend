// Shared reader for a saved meal's nutritionSnapshot.components — pc-HUM-207.
// ONE item per top-level component: a mixed dish stays intact (never descended
// into nested recipe ingredients), valid top-level grams are preserved, and
// unverified grams stay null. Rejects unusable/over-limit compositions whole —
// never produces partial guidance.
const MAX_COMPONENTS = 20;
const MAX_GRAMS = 20000;

/**
 * @returns {{ items: {name:string, amountG:number|null}[] } | { error: string }}
 */
function readStoredComposition(snapshot) {
  const comps = snapshot?.components;
  if (!Array.isArray(comps) || !comps.length) return { error: 'no_components' };
  if (comps.length > MAX_COMPONENTS) return { error: 'over_limit' };
  const items = [];
  for (const c of comps) {
    if (!c || typeof c !== 'object' || typeof c.foodName !== 'string' || !c.foodName.trim()) return { error: 'unusable' };
    let amountG = null;
    if (c.amountG != null) {
      if (typeof c.amountG !== 'number' || !Number.isFinite(c.amountG) || c.amountG <= 0 || c.amountG > MAX_GRAMS) return { error: 'unusable' };
      amountG = c.amountG;
    }
    // exactly one item per entered dish or side — never decompose mixed dishes
    items.push({ name: c.foodName.trim(), amountG });
  }
  return { items };
}

module.exports = { readStoredComposition, MAX_COMPONENTS };
