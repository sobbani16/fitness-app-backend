// FL-001 remediation — populate IngredientServing from VERIFIED USDA
// foodPortions (Foundation/SR Legacy/Survey detail records). Never fabricates
// a conversion: if no confident USDA match exists, the item is reported as
// needs-human. Dry-run by default; `--apply` persists.
//
// Usage:
//   node scripts/import-ingredient-servings.js                 # dry-run, priority set
//   node scripts/import-ingredient-servings.js --apply         # apply priority set
//   node scripts/import-ingredient-servings.js --catalog-id=bread_wholewheat [--query="bread, whole-wheat"] [--apply]
require('dotenv').config({ quiet: true });
const { getPrisma } = require('../src/lib/prisma');
const { searchUsda, getUsdaFood } = require('../src/services/usdaService');
const db = getPrisma();

const APPLY = process.argv.includes('--apply');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? null;

// catalogId -> USDA query. Queries tuned to hit SR Legacy/Foundation records.
const PRIORITY = {
  bread_wholewheat: 'bread, whole-wheat, commercially prepared',
  bread_white: 'bread, white, commercially prepared',
  pita_bread: 'bread, pita, white',
  egg_boiled: 'egg, whole, boiled',
  egg_raw: 'egg, whole, raw, fresh',
  banana: 'bananas, raw',
  apple: 'apple',
  milk_whole: 'milk, whole, 3.25% milkfat',
  milk_lowfat: 'milk, lowfat, fluid, 1% milkfat',
  aata_roti: 'bread, chapati or roti, whole wheat',
  almond: 'nuts, almonds',
  peanut_butter: 'peanut butter, smooth style',
  chicken_breast_cooked: 'chicken, broilers or fryers, breast, meat only, cooked, roasted',
  chicken_breast_raw: 'chicken, broilers or fryers, breast, meat only, raw',
  yogurt_greek: 'yogurt, Greek, plain, nonfat',
  yogurt_plain: 'yogurt, plain, whole milk',
  pizza_base: 'pizza, cheese topping, regular crust',
  oats_dry: 'oats',
};
const DATATYPE_RANK = { 'Foundation': 0, 'SR Legacy': 1, 'Survey (FNDDS)': 2, 'Branded': 3 };
// Pinned fdcIds for items where USDA search ranking can't surface the right
// record. Verified via getUsdaFood before pinning.
const FDC_PIN = { apple: '171688' };

const cleanLabel = (p) => {
  const desc = (p.portionDescription || '').trim();
  if (desc && /\d/.test(desc)) return desc; // "1 slice", "2 tbsp" verbatim
  const unit = (p.measureUnit?.name || '').trim();
  const mod = (p.modifier || '').trim();
  const qty = p.amount != null && p.amount !== 1 ? `${p.amount} ` : '1 ';
  // measureUnit "slice" + modifier null → "1 slice"; unit "undetermined"
  // + modifier "slice" → "1 slice"; "cup, cubes" → "1 cup, cubes"
  const parts = [unit !== 'undetermined' ? unit : '', mod].filter(Boolean);
  return (qty + (parts.length ? parts.join(', ') : 'portion')).replace(/\s+/g, ' ').trim();
};

(async () => {
  const report = { applied: [], skipped: [], needsHuman: [], details: {} };
  const single = arg('catalog-id');
  const targets = single ? { [single]: arg('query') || PRIORITY[single] || null } : PRIORITY;

  for (const [catalogId, query] of Object.entries(targets)) {
    const cat = await db.ingredientCatalog.findUnique({ where: { id: catalogId }, include: { ingredient: { include: { servings: true } } } }).catch(() => null);
    if (!cat?.ingredient) { report.needsHuman.push({ catalogId, reason: 'no catalog/ingredient row' }); continue; }
    if (cat.ingredient.servings?.length && !arg('force')) { report.skipped.push({ catalogId, reason: `already has ${cat.ingredient.servings.length} servings` }); continue; }
    const fdc = arg('fdc') || FDC_PIN[catalogId];
    let detail = null, chosen = null;
    if (fdc) {
      try { detail = await getUsdaFood(fdc); if (!detail.foodPortions.length && !(detail.servingSize > 0)) detail = null; } catch (e) { report.needsHuman.push({ catalogId, reason: `pinned fdc ${fdc} failed: ${e.message}` }); continue; }
      if (!detail) { report.needsHuman.push({ catalogId, reason: `pinned fdc ${fdc} has no portions` }); continue; }
    } else {
    const q = query || cat.name.replace(/,.*$/, '');
    let usdaHits = null;
    for (let attempt = 0; attempt < 3 && !usdaHits; attempt++) {
      try { usdaHits = await searchUsda(q, 5); } catch (e) { if (attempt === 2) { report.needsHuman.push({ catalogId, reason: `usda search failed: ${e.message}` }); } else await new Promise((r) => setTimeout(r, 900 * (attempt + 1))); }
    }
    if (!usdaHits) continue;
    await new Promise((r) => setTimeout(r, 350));
    if (!usdaHits.length) { report.needsHuman.push({ catalogId, reason: `no usda hit for '${q}'` }); continue; }
    // Prefer Foundation/SR Legacy/Survey detail records; try in rank order.
    const ranked = [...usdaHits].sort((a, b) => (DATATYPE_RANK[a.sourceMetadata?.dataType] ?? 9) - (DATATYPE_RANK[b.sourceMetadata?.dataType] ?? 9));
    // Sanity: the chosen record must contain every informative query token
    // (prevents 'oats, raw' matching 'Oat milk').
    const tokens = q.toLowerCase().split(/[,\s\-/]+/).filter((t) => /^[a-z]{3,}$/.test(t) && !['the', 'and', 'with', 'only', 'meat'].includes(t));
    const sane = (d) => { const desc = ` ${d.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `; return tokens.every((t) => new RegExp(`\\b${t.replace(/s$/, '')}s?\\b`).test(desc)) && !(AVOID[catalogId] || []).some((a) => desc.includes(a)); };
    const AVOID = { apple: ['without skin'], oats_dry: ['bran', 'milk'] };
    for (const h of ranked.slice(0, 5)) {
      try {
        const d = await getUsdaFood(h.fdcId);
        if (!sane(d)) continue;
        if (d.foodPortions.length) { detail = d; chosen = h; break; }
        if (!detail) { detail = d; chosen = h; }
      } catch { /* next */ }
    }
    } // end else (search path)
    const servings = [];
    if (detail?.foodPortions.length) {
      const usable = detail.foodPortions.filter((p) => {
        const lbl = cleanLabel(p);
        return !/^[0-9\s]+$/.test(lbl) && !/^1\s+(portion|undetermined)$/.test(lbl) // drop "1 90000" junk rows
          && !/^\d+(\.\d+)?\s*(oz|ounces?|lbs?|g|grams?|kg|ml|fl\s?oz)$/i.test(lbl); // drop pure weight-unit pseudo-servings
      });
      servings.push(...usable.slice(0, 12).map((p, i) => ({
        id: `srv_${catalogId}_${p.sequenceNumber ?? i}`,
        ingredientId: cat.ingredient.id,
        label: cleanLabel(p).slice(0, 80),
        grams: p.gramWeight,
        estimated: false,
        sourceRecord: { source: 'USDA FoodData Central', fdcId: detail.fdcId, description: detail.description, dataType: detail.dataType, measureUnit: p.measureUnit?.name || null, portionDescription: p.portionDescription || null, gramWeight: p.gramWeight, importedAt: new Date().toISOString(), importScript: 'import-ingredient-servings.js' },
      })));
    }
    // Branded/label records: manufacturer-declared serving (e.g. "1 slice", 32 g)
    // is a verified serving for THAT product — import it, flagged branded.
    if (!servings.length && detail && Number.isFinite(detail.servingSize) && detail.servingSize > 0 && detail.householdServingFullText && ['g', 'gm', 'ml'].includes(String(detail.servingSizeUnit || '').toLowerCase())) {
      servings.push({
        id: `srv_${catalogId}_label`,
        ingredientId: cat.ingredient.id,
        label: detail.householdServingFullText.slice(0, 80),
        grams: detail.servingSize,
        estimated: false,
        sourceRecord: { source: 'USDA FoodData Central (branded label serving)', fdcId: detail.fdcId, description: detail.description, dataType: detail.dataType, brandOwner: detail.brandOwner || null, servingSize: detail.servingSize, servingSizeUnit: detail.servingSizeUnit, importedAt: new Date().toISOString(), importScript: 'import-ingredient-servings.js' },
      });
    }
    if (!servings.length) {
      report.needsHuman.push({ catalogId, reason: `no foodPortions or label serving (closest: ${chosen?.name} ${chosen?.fdcId})`, usdaHits: usdaHits.map((x) => `${x.name} [${x.fdcId}]`) });
      continue;
    }
    report.details[catalogId] = { ingredient: cat.ingredient.id, usda: `${detail.description} [${detail.fdcId}] ${detail.dataType}`, servings: servings.map((s) => `${s.label} = ${s.grams}g`) };
    if (APPLY) {
      for (const s of servings) await db.ingredientServing.upsert({ where: { id: s.id }, create: s, update: { label: s.label, grams: s.grams, estimated: s.estimated, sourceRecord: s.sourceRecord } });
      report.applied.push(catalogId);
    } else report.skipped.push({ catalogId, reason: 'dry-run' });
  }
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
