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
// Coverage-expansion queries (Phase 1 of release-blocker closure). Each query
// is tuned so every informative token appears in the USDA description — the
// sane() check rejects mismatches, unresolvable items land in needsHuman.
const EXTRA = {
  amaranth_raw: 'amaranth leaves, raw', arborio_rice_dry: 'rice, arborio', asparagus: 'asparagus, raw',
  atta: 'wheat flour, whole-grain', avocado_raw: 'avocados, raw', bacon: 'bacon, cooked, pan-fried',
  baguette: 'bread, french', bajra_flour: 'millet flour', baking_powder: 'baking powder',
  balsamic_vinegar: 'vinegar, balsamic', bamboo_shoots_canned: 'bamboo shoots, canned',
  basil_fresh: 'basil, fresh', bay_leaf: 'bay leaf', bean_sprouts_raw: 'mung beans, sprouted, raw',
  beans_green: 'beans, snap, green, raw', beef_lean_raw: 'beef, loin, lean, raw', beetroot_raw: 'beets, raw',
  bittergourd_raw: 'bitter gourd, raw', black_beans_cooked: 'beans, black, cooked',
  black_olives: 'olives, ripe, canned', black_pepper: 'pepper, black', blackchana_cooked: 'chickpeas, boiled',
  bottlegourd_raw: 'gourd, calabash, raw', breadcrumbs: 'bread crumbs', broccoli_raw: 'broccoli, raw',
  brown_lentils_dry: 'lentils, raw', bulgur_wheat_dry: 'bulgur, dry', burger_bun: 'rolls, hamburger',
  butter: 'butter, without salt', cabbage_raw: 'cabbage, raw', canned_tomatoes: 'tomatoes, canned',
  capsicum_raw: 'peppers, sweet, green, raw', cardamom: 'cardamom', carrot_raw: 'carrots, raw',
  cashew: 'cashew nuts, raw', cauliflower_raw: 'cauliflower, raw', celery_raw: 'celery, raw',
  chana_dal_dry: 'chickpeas, raw', cheddar_cheese: 'cheese, cheddar', cheese_ravioli: 'ravioli, cheese',
  chia: 'chia seeds', chicken_broth: 'chicken broth', chicken_thigh_raw: 'chicken, broilers or fryers, thigh, meat only, raw',
  chickpea_cooked: 'chickpeas, boiled', chili_flakes: 'pepper, cayenne', cinnamon: 'cinnamon, ground',
  clove: 'cloves, ground', cocoa_powder: 'cocoa, dry powder, unsweetened', coconut_fresh: 'coconut meat, raw',
  coconut_milk_canned: 'coconut milk, canned', coriander_powder: 'coriander seed', coriander_raw: 'cilantro, raw',
  corn_kernels: 'corn, sweet, yellow, raw', corn_tortilla: 'tortilla, corn', cornstarch: 'cornstarch',
  cream_cheese: 'cream cheese', cucumber_raw: 'cucumber, raw', cumin_powder: 'cumin seed',
  cumin_seeds: 'cumin seed', curry_powder: 'curry powder', dates: 'dates', dill: 'dill weed',
  drumstick_raw: 'drumstick pods, raw', dumpling_wrappers: 'wonton wrappers', egg_noodles_dry: 'egg noodles, dry',
  eggplant_raw: 'eggplant, raw', enchilada_sauce: 'enchilada sauce', espresso_coffee: 'espresso',
  fenugreek_seeds: 'fenugreek', feta: 'cheese, feta', fish_sauce: 'fish sauce',
  fish_white_raw: 'whitefish, raw', flaxseed: 'flaxseed', flour_tortilla: 'tortilla, flour',
  garlic_raw: 'garlic, raw', ghee: 'butter oil', ginger_raw: 'ginger root, raw',
  glutinous_rice_dry: 'rice, glutinous, raw', gnocchi_potato: 'gnocchi, potato', gochujang: 'gochujang',
  granola: 'granola', green_chili: 'peppers, hot chili, green, raw', ground_beef_raw: 'beef, ground, 85% lean, raw',
  heavy_cream: 'cream, heavy', hoisin_sauce: 'hoisin sauce', hominy_canned: 'hominy, canned',
  honey: 'honey', hummus: 'hummus', idli_rice_dry: 'rice, parboiled, dry', imitation_crab: 'surimi',
  jaggery: 'jaggery', jalapeno: 'jalapeno', jowar_flour: 'sorghum flour', ketchup: 'catsup',
  kidneybeans_cooked: 'kidney beans, cooked', kimchi: 'kimchi', ladyfinger_biscuit: 'ladyfingers',
  lamb_raw: 'lamb, raw', lasagna_sheets_dry: 'lasagna', lemon_juice: 'lemon juice', lemongrass: 'lemon grass',
  lettuce: 'lettuce, romaine, raw', lime: 'limes, raw', lime_juice: 'lime juice',
  maida: 'wheat flour, all-purpose', mango: 'mangos, raw', maple_syrup: 'maple syrup',
  marinara_sauce: 'marinara sauce', mascarpone: 'mascarpone', masoor_dal_dry: 'lentils, pink or red, raw',
  mayonnaise: 'mayonnaise', mint_leaves: 'spearmint, fresh', miso_paste: 'miso',
  moong_dal_dry: 'mung beans, raw', moong_whole_dry: 'mung beans, raw', mozzarella: 'mozzarella, whole milk',
  mushroom_raw: 'mushrooms, raw', mustard: 'mustard, prepared, yellow', mustard_seeds: 'mustard seed',
  nori_seaweed: 'nori', oil_coconut: 'oil, coconut', oil_generic: 'oil, vegetable', oil_mustard: 'mustard oil',
  oil_olive: 'oil, olive', oil_sesame: 'oil, sesame', okra_raw: 'okra, raw', onion_raw: 'onions, raw',
  orange: 'oranges, raw', oregano_dried: 'oregano, dried', oyster_sauce: 'oyster sauce',
  paneer_fullfat: 'paneer', paneer_lowfat: 'paneer', papaya: 'papayas, raw', paprika: 'paprika',
  parmesan: 'parmesan', parsley: 'parsley, fresh', pasta_cooked: 'pasta, cooked', peanut: 'peanuts, raw',
  peas_green: 'peas, green, raw', pesto_basil: 'pesto', pie_crust: 'pie crust', pineapple_raw: 'pineapple, raw',
  pinto_beans_cooked: 'beans, pinto, cooked', pomegranate: 'pomegranates, raw', pork_lean_raw: 'pork, loin, lean, raw',
  potato_boiled: 'potatoes, boiled', potato_raw: 'potatoes, raw', prawns_raw: 'shrimp, raw',
  pumpkin_raw: 'pumpkin, raw', quinoa_cooked: 'quinoa, cooked', radish_raw: 'radishes, raw',
  raisins: 'raisins', ramen_noodles_dry: 'ramen noodles', raw_mango: 'mangos, raw',
  red_chili_dry: 'pepper, cayenne', refried_beans: 'refried beans', rice_basmati_cooked: 'rice, basmati, cooked',
  rice_brown_cooked: 'rice, brown, cooked', rice_noodles_dry: 'rice noodles', rice_white_cooked: 'rice, white, cooked',
  rice_white_dry: 'rice, white, raw', saffron: 'saffron', salmon_raw: 'salmon, atlantic, raw',
  salt: 'salt, table', sauerkraut: 'sauerkraut', sausage: 'sausage, pork', scallions: 'scallions',
  semolina: 'semolina', sesame: 'sesame seeds', soba_noodles_dry: 'soba', sour_cream: 'sour cream',
  soy_sauce: 'soy sauce', spinach_raw: 'spinach, raw', sriracha: 'sriracha', sugar: 'sugar, granulated',
  sushi_rice_cooked: 'rice, short-grain, cooked', sweetpotato_raw: 'sweet potato, raw', tahini: 'tahini',
  tamarind_pulp: 'tamarind', tofu_firm: 'tofu, firm', tomato_paste: 'tomato paste', tomato_raw: 'tomatoes, raw',
  toor_dal_dry: 'pigeon peas, raw', turkey_raw: 'turkey breast, raw', turmeric_powder: 'turmeric',
  udon_noodles: 'udon', urad_dal_dry: 'mungo beans, raw', vegetable_broth: 'vegetable broth',
  vermicelli_dry: 'vermicelli', vinegar_rice: 'rice vinegar', vinegar_white: 'vinegar, distilled',
  whey_powder: 'whey protein', white_beans_cooked: 'white beans, cooked', zucchini_raw: 'zucchini, raw',
};
const QUERIES = { ...EXTRA, ...PRIORITY };
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
  let targets = {};
  if (single) targets = { [single]: arg('query') || QUERIES[single] || null };
  else if (process.argv.includes('--all')) {
    // Catalog-wide pass: every usable catalog item whose ingredient has no
    // serving rows. Query comes from the tuned map; fallback is the cleaned
    // catalog name (parentheticals and proxy notes stripped).
    const cats = await db.ingredientCatalog.findMany({ where: { usable: true }, include: { ingredient: { include: { servings: true } } } });
    for (const c of cats) {
      if (c.ingredient?.servings?.length) continue;
      const name = c.name.replace(/\(.*?\)/g, ' ').replace(/—.*$/, ' ').replace(/\s+/g, ' ').trim();
      targets[c.id] = QUERIES[c.id] || name;
    }
  } else targets = QUERIES;

  for (const [catalogId, query] of Object.entries(targets)) {
    const cat = await db.ingredientCatalog.findUnique({ where: { id: catalogId }, include: { ingredient: { include: { servings: true } } } }).catch(() => null);
    if (!cat?.ingredient) { report.needsHuman.push({ catalogId, reason: 'no catalog/ingredient row' }); continue; }
    if (cat.ingredient.servings?.length && !arg('force')) { report.skipped.push({ catalogId, reason: `already has ${cat.ingredient.servings.length} servings` }); continue; }
    const fdc = arg('fdc') || FDC_PIN[catalogId];
    let detail = null, chosen = null, usdaHits = [];
    if (fdc) {
      try { detail = await getUsdaFood(fdc); if (!detail.foodPortions.length && !(detail.servingSize > 0)) detail = null; } catch (e) { report.needsHuman.push({ catalogId, reason: `pinned fdc ${fdc} failed: ${e.message}` }); continue; }
      if (!detail) { report.needsHuman.push({ catalogId, reason: `pinned fdc ${fdc} has no portions` }); continue; }
    } else {
    const q = query || cat.name.replace(/,.*$/, '');
    usdaHits = null;
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
    const AVOID = {
      apple: ['without skin'], oats_dry: ['bran', 'milk'],
      beef_lean_raw: ['variety', 'brain', 'tongue', 'heart', 'kidney', 'liver', 'tripe', 'spleen', 'thymus', 'pancreas', 'lung', 'sweetbread', 'by-product', 'ground'],
      lamb_raw: ['variety', 'brain', 'tongue', 'heart', 'kidney', 'liver', 'tripe', 'spleen', 'thymus', 'by-product'],
      pork_lean_raw: ['variety', 'brain', 'tongue', 'heart', 'kidney', 'liver', 'tripe', 'belly', 'fat back', 'ground'],
      bacon: ['rendered', 'canadian', 'turkey', 'bits', 'grease'],
      butter: ['oil', 'clarified', 'anhydrous', 'margarine'],
      salmon_raw: ['canned', 'cooked', 'smoked'],
      sausage: ['turkey', 'beef, reduced', 'blood', 'liverwurst'],
      cheese_ravioli: ['meat-filled'],
      tofu_firm: ['fried', 'dried', 'salted', 'fermented'],
      mozzarella: ['part skim', 'low moisture'],
      orange: ['juice'],
      mango: ['dried'],
      coconut_milk_canned: ['light', 'lite', 'beverage'],
      scallions: ['dehydrated'],
      peanut: ['boiled', 'roasted', 'oil-roasted', 'honey'],
      cashew: ['roasted'],
      corn_kernels: ['cream', 'frozen', 'baby'],
      canned_tomatoes: ['sauce', 'paste', 'juice', 'stewed'],
      hominy_canned: [],
      turkey_raw: ['ground', 'deli', 'cured'],
      mushroom_raw: ['shiitake', 'oyster', 'portabella', 'canned'],
      rice_white_dry: ['glutinous', 'basmati', 'jasmine', 'parboiled'],
      rice_white_cooked: ['glutinous', 'basmati', 'jasmine', 'fried'],
      rice_basmati_cooked: ['fried'],
      pasta_cooked: ['whole-wheat', 'whole grain', 'spinach', 'gluten'],
      granola: ['bar'],
      mayonnaise: ['light', 'fat free', 'reduced fat'],
      sour_cream: ['light', 'fat free', 'imitation'],
      cream_cheese: ['fat free', 'light'],
      heavy_cream: ['whipped', 'light'],
      paneer_lowfat: ['full fat'],
      oil_generic: ['coconut', 'olive', 'sesame', 'mustard', 'canola'],
      feta: ['reduced fat'],
      cheddar_cheese: ['lowfat', 'imitation'],
      parmesan: ['grated, topping', 'reduced fat'],
      hummus: ['flavored'],
      pesto_basil: ['creamy'],
      pie_crust: ['graham', 'chocolate', 'cookie'],
      flour_tortilla: ['whole wheat', 'whole-wheat', 'low carb'],
      corn_tortilla: ['flour'],
      dumpling_wrappers: ['egg roll'],
      rice_noodles_dry: ['cooked'],
      egg_noodles_dry: ['spinach'],
      udon_noodles: ['cooked'],
      soba_noodles_dry: ['cooked'],
      ramen_noodles_dry: ['cooked, without', 'flavor'],
      vermicelli_dry: ['rice'],
      gnocchi_potato: ['sweet potato'],
      enchilada_sauce: ['green'],
      marinara_sauce: ['meat'],
      miso_paste: ['soup'],
      tahini: ['roasted'],
      maple_syrup: ['imitation', 'table'],
      ketchup: ['low sodium'],
      mustard: ['honey', 'dijon'],
      fish_sauce: ['oyster', 'soy', 'hoisin'],
      oyster_sauce: ['fish', 'soy', 'hoisin'],
      hoisin_sauce: ['fish', 'soy', 'oyster'],
      soy_sauce: ['tamari', 'low sodium', 'reduced sodium'],
      vegetable_broth: ['chicken', 'beef'],
      chicken_broth: ['vegetable', 'beef'],
      salt: ['sea salt, coarse'],
      sugar: ['powdered', 'brown'],
      honey: ['comb'],
      cocoa_powder: ['sweetened'],
      semolina: ['pudding'],
      atta: ['all-purpose', 'bread', 'white'],
      maida: ['whole', 'bread', 'self-rising'],
      whey_powder: ['milk', 'cheese'],
      imitation_crab: ['legs'],
      prawns_raw: ['cooked', 'canned', 'breaded'],
      fish_white_raw: ['dried', 'cooked', 'smoked'],
    };
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
