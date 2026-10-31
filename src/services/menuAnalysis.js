// Structured menu analysis — deterministic core over the existing
// parser + nutrition enrichment. AI may decode layout but can never
// invent nutrition values, allergen safety, or ingredients.
const { parseMenuText } = require('./menuParser');
const { enrichMenuItems } = require('./menuNutrition');
const { askJSON, aiEnabled } = require('./aiProvider');
const { httpError } = require('../lib/errors');

const ANALYSIS_VERSION = 'menu-analysis.v1';

const AI_SCHEMA = {
  restaurant: { type: 'string' },
  items: { type: 'array', maxItems: 60, items: {
    type: 'object', additionalProperties: false, properties: {
      name: { type: 'string' }, description: { type: 'string' },
      price: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] },
      calories: { type: ['number', 'null'] }, section: { type: ['string', 'null'] },
    }, required: ['name', 'description', 'price', 'currency', 'calories', 'section'],
  } },
};

// Conservative allergen/restriction keyword scan. Flags uncertainty —
// never declares safety ("free from X" is never claimed).
const ALLERGEN_TERMS = {
  gluten: [/wheat|bread|bun|pasta|noodle|soy sauce|seitan|flour/i],
  dairy: [/milk|cheese|parmesan|cheddar|mozzarella|butter|cream|ghee|paneer|yogurt|whey/i],
  nuts: [/almond|cashew|peanut|walnut|pistachio|hazelnut|nut\b/i],
  shellfish: [/shrimp|prawn|crab|lobster|scallop|shellfish/i],
  fish: [/fish|salmon|tuna|cod|anchov/i],
  egg: [/egg|mayo|aioli/i],
  soy: [/soy|tofu|edamame|miso|tempeh/i],
  sesame: [/sesame|tahini/i],
};
const RESTRICTION_TERMS = {
  vegetarian: [/chicken|beef|pork|lamb|mutton|fish|salmon|tuna|cod|shrimp|prawn|crab|bacon|ham|turkey|pepperoni/i],
  vegan: [/chicken|beef|pork|lamb|mutton|fish|salmon|tuna|cod|shrimp|prawn|crab|bacon|ham|turkey|milk|cheese|parmesan|butter|cream|ghee|paneer|yogurt|egg|honey|mayo/i],
  'low-sodium': [/soy sauce|pickled|cured|bacon|ham|salted|broth|teriyaki/i],
};

function flagItem(item, prefs = {}) {
  const text = `${item.name} ${item.description || ''}`;
  const flags = [];
  for (const a of prefs.allergies || []) {
    const hits = (ALLERGEN_TERMS[a] || []).filter(rx => rx.test(text));
    if (hits.length) flags.push({ type: 'allergen', key: a, level: 'verify',
      note: `Description mentions a possible ${a} source — confirm ingredients and cross-contact with the restaurant.` });
  }
  for (const r of prefs.restrictions || []) {
    const hits = (RESTRICTION_TERMS[r] || []).filter(rx => rx.test(text));
    if (hits.length) flags.push({ type: 'restriction', key: r, level: 'verify',
      note: `May not fit your ${r} preference — verify preparation before ordering.` });
  }
  return flags;
}

function goalNote(item, goal) {
  const est = item.estimate;
  const kcal = item.calories ?? (est ? (est.calories.min + est.calories.max) / 2 : null);
  if (kcal == null) return 'Nutrition not available — ask about portion or estimate manually.';
  switch (goal) {
    case 'weight_loss': return kcal <= 500 ? `~${Math.round(kcal)} kcal fits a lighter-meal target.` : `~${Math.round(kcal)} kcal is a larger share of a reduced-calorie day — compare portions.`;
    case 'weight_gain':
    case 'muscle_gain': {
      const p = est?.proteinG ? (est.proteinG.min + est.proteinG.max) / 2 : null;
      return p != null && p >= 25 ? `~${Math.round(p)} g protein supports your muscle-gain target.` : `~${Math.round(kcal)} kcal; pair with a protein-rich side if building.`;
    }
    default: return `~${Math.round(kcal)} kcal — fits a balanced day in moderation.`;
  }
}

function confidenceOf(item) {
  if (item.nutritionSource === 'restaurant-reported') return 'high';
  if (item.nutritionSource === 'estimated') return 'medium';
  return 'low';
}

async function analyzeMenu({ prisma, userId, ocrTexts = [], images = [], restaurantName, preferences = {} }) {
  if (!Array.isArray(ocrTexts) || ocrTexts.length > 6 || ocrTexts.some(t => typeof t !== 'string' || t.length > 20000)
      || !Array.isArray(images) || images.length > 6) throw httpError(400, 'Provide up to six menu pages.');
  if (restaurantName != null && (typeof restaurantName !== 'string' || restaurantName.length > 200)) throw httpError(400, 'Invalid restaurant name.');
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw httpError(400, 'Invalid menu preferences.');
  for (const key of ['allergies', 'restrictions']) {
    if (preferences[key] != null && (!Array.isArray(preferences[key]) || preferences[key].length > 16 || preferences[key].some(v => typeof v !== 'string' || v.length > 100))) throw httpError(400, 'Invalid menu preferences.');
  }
  let items = [];
  const sources = [];
  for (const text of ocrTexts) {
    const parsed = parseMenuText(text, { restaurantName });
    if (parsed.items?.length || parsed.restaurant) {
      items.push(...(parsed.items || []));
      if (!restaurantName && parsed.restaurant) restaurantName = parsed.restaurant;
      // Bare first line (no price/cal/description/section) is a header, not a dish.
      if (!restaurantName && items[0] && items[0].price == null && items[0].calories == null
          && !items[0].description && !items[0].section) {
        restaurantName = items.shift().name;
      }
      sources.push('ocr');
    }
  }
  // AI layout interpretation only when OCR yields nothing and AI is enabled.
  if (!items.length && images.length && aiEnabled()) {
    for (const image of images) {
    const raw = await askJSON('menu_extraction', AI_SCHEMA,
      'Extract menu items from this image. Report only printed text — never estimate calories, nutrition, or ingredients. Set calories only if a calorie number is printed. Output strict JSON.',
      'Extract the menu structure.', image, userId);
    items.push(...(raw.items || []).map(i => ({ ...i, calorieSource: i.calories != null ? 'restaurant-reported' : null })));
    if (!restaurantName && raw.restaurant) restaurantName = raw.restaurant;
    }
    sources.push('ai-layout');
  }
  if (!items.length) throw httpError(422, 'No menu items could be extracted. Try a clearer photo or enter dishes manually.');

  const enriched = await enrichMenuItems(prisma, items);
  const personalized = enriched.map(it => {
    const flags = flagItem(it, preferences);
    return {
      ...it, flags, confidence: confidenceOf(it),
      why: goalNote(it, preferences.goal),
      action: flags.length ? 'Verify with restaurant before ordering' : null,
    };
  });
  return {
    version: ANALYSIS_VERSION, restaurant: restaurantName || null, source: sources,
    items: personalized,
    disclaimer: 'Estimates are approximations, not measurements. Allergen flags mark possible sources only — absence of a flag never means allergen-free.',
  };
}

module.exports = { analyzeMenu, flagItem, goalNote, ANALYSIS_VERSION };
