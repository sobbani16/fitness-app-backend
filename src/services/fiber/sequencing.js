// Fiber-first meal sequencing — deterministic, evidence-informed, optional.
//
// Core principle: FIBER-first, not simply vegetable-first. A component earns
// the first slot only when it is a *meaningful fiber source* — practically,
// a non-starchy vegetable with real fiber per the resolved per-100g profile.
// Legumes, fruit, nuts and whole grains contain fiber too, but they also
// carry meaningful carbs/fat — they get contextual placement, never an
// automatic first rank.
//
// Separability: sequencing is only suggested when components can plausibly be
// eaten separately. Mixed dishes (biryani, khichdi, pizza, sandwich, noodle
// dishes…) are flagged `separable: false` — we do not invent unrealistic
// ingredient separation.
//
// Claims discipline: output is an *optional suggestion* informed by
// meal-ordering research; it NEVER promises glucose-spike prevention.

const { getPrisma } = require('../../lib/prisma');
const { normalize } = require('../ingredientCsv');
const { classifyFood } = require('../ingredientImpact');
const { suggestFoods } = require('./suggestions');

const SEQUENCE_VERSION = 'fiber-sequence-v1';

// Meaningful fiber for a *component*: ≥2 g in the eaten portion when known,
// or a per-100g profile ≥1.5 g when portion math is unreliable.
const MIN_COMPONENT_FIBER_G = 2;
const MIN_FIBER_PER_100G = 1.5;

// Dishes whose components can't realistically be eaten in sequence.
const MIXED_DISH_RE = /\b(biryani|khichdi|kichdi|pulao|pilaf|fried rice|pizza|sandwich|burger|wrap|quesadilla|burrito|pasta|lasagna|noodle|ramen|pad thai|chow mein|hakka|poha|upma|pongal|bisibelebath|bisi bele bath|risotto|paella|casserole|stew|curry rice|dal chawal|rajma chawal|chole chawal|paratha|thali|dosa|idli|uttapam|salad bowl|poke|grain bowl|buddha bowl|smoothie|shake|juice|soup|khichdi|tahdig|momos?|dumpling|spring roll|samosa chaat|chaat|frankie|kathi roll|shawarma|tacos?|enchilada|fajita|omelette|scrambled|pancake|waffle|cereal|muesli|granola|porridge|khichra|haleem|shepherd'?s pie|pot pie|mac and cheese|macaroni|maggi|khow suey|thukpa|manchurian|chilli (chicken|paneer)|fried chicken curry|coleslaw)\b/i;

// Starch-dominant carb names — the "last" bucket. Refined vs whole grain both
// land here; fiber content doesn't make rice "first" even when brown.
const STARCH_RE = /\b(rice|chawal|roti|chapati|naan|bread|bun|pav|paratha|puri|bhatura|kulcha|dosa|idli|pizza base|tortilla|wrap|potato|aloo|fries|chips|pasta|noodle|spaghetti|macaroni|maggi|maida|sooji|rava|sago|sabudana|tapioca|yam|colocasia|arbi|plantain|corn|maize|polenta|quinoa|oats|porridge|cereal|muesli|upma|poha|vermicelli|seviyan|couscous|bulgur|barley|millet|ragi|jowar|bajra|bread|roll|croissant|bagel|crackers?)\b/i;

// Protein-dominant names.
const PROTEIN_RE = /\b(chicken|murg|fish|machli|salmon|tuna|prawn|shrimp|egg|anda|omelette|mutton|lamb|beef|pork|turkey|keema|kebab|tikka|tandoori|paneer|tofu|soya (chunk|granule)|soy granule|whey|greek yogurt|hung curd|sprouts?|moong|masoor|tur|toor|urad|chana dal|arhar|lobia|black[- ]?eyed|kidney bean|rajma|chole|chickpea|hummus|lentil|dal\b)/i;

// Non-starchy vegetable names.
const NON_STARCHY_VEG_RE = /\b(broccoli|spinach|palak|cabbage|patta gobhi|cauliflower|phool gobhi|gobi|okra|bhindi|(green|french|string|snap)\s*beans?|capsicum|shimla|bell pepper|cucumber|kheera|tomato|tamatar|lettuce|salad|zucchini|courgette|brinjal|baingan|eggplant|aubergine|bitter gourd|karela|bottle gourd|lauki|doodhi|ridge gourd|turai|tori|snake gourd|ash gourd|petha|pumpkin(?!.*(pie|sweet))|kaddu|carrot(?!.*(halwa|juice))|gajar|radish|mooli|turnip|shalgam|beetroot(?!.*(juice|halwa))|chukandar|celery|mushroom|khumb|spring onion|green onion|scallion|leafy|methi|fenugreek leaf|sarson|saag|mustard green|chaulai|amaranth|colocasia leaf|arbi ke patte|drumstick|sahjan|moringa|tinda|parwal|pointed gourd|ivy gourd|tindora|kundru|broccoli|zoodles)\b/i;

const FRUIT_RE = /\b(apple|pear|guava|orange|santra|banana|kela|papaya|papita|berries|strawberr|blueberr|raspberr|pomegranate|anar|kiwi|mango|grapes|angoor|pineapple|watermelon|melon|muskmelon|peach|plum|apricot|fig|anjeer|dates|khajoor)\b/i;
const NUT_SEED_RE = /\b(almond|badam|walnut|akhrot|cashew|kaju|pistachio|pista|peanut|moongphali|chia|flax|alsi|sesame|til|sunflower|pumpkin seed|mixed nuts|trail mix|peanut butter)\b/i;
const DAIRY_RE = /\b(milk|doodh|curd|dahi|yogurt|raita|buttermilk|chaas|lassi|paneer|cheese|cream|malai|khoya|ghee|butter)\b/i;

const ROLE_LABEL = {
  non_starchy_veg: 'fiber-rich vegetable',
  legume: 'legume (fiber + protein)',
  protein: 'protein',
  starch: 'starchy carbohydrate',
  fruit: 'fruit',
  nuts_seeds: 'nuts/seeds',
  dairy: 'dairy',
  fat: 'added fat',
  sweet: 'sweet/sugar',
  other: 'other',
  unknown: 'unclassified',
};

function roleFor(component, ing) {
  const name = String(component.name || component.foodName || '').toLowerCase();
  const per100 = ing ? { calories: ing.caloriesPer100g, proteinG: ing.proteinPer100g, carbsG: ing.carbsPer100g, fatG: ing.fatPer100g, fiberG: ing.fiberPer100g } : {};
  const cls = classifyFood({ name, per100 });
  const cats = new Set(cls.categories);

  // Name signals outrank nutrient-derived hints — an apple's fiber must never
  // win the "non-starchy vegetable first" slot just because it is low-kcal.
  if (NON_STARCHY_VEG_RE.test(name)) return 'non_starchy_veg';
  if (cats.has('legumes_soy') || /\b(dal|lentil|chickpea|chana|rajma|bean|lobia|chole|sprout|moong|masoor|urad|toor|arhar)\b/i.test(name)) return 'legume';
  if (NUT_SEED_RE.test(name) || cats.has('nuts_seeds')) return 'nuts_seeds';
  if (FRUIT_RE.test(name)) return 'fruit';
  if (DAIRY_RE.test(name) || cats.has('dairy_paneer_cream')) return 'dairy';
  if (PROTEIN_RE.test(name) || cats.has('protein_foods')) return 'protein';
  if (STARCH_RE.test(name) || cats.has('refined_carb') || cats.has('whole_grain')) return 'starch';
  if (cats.has('fruit_vegetable')) return 'non_starchy_veg';
  if (cats.has('cooking_fat')) return 'fat';
  if (cats.has('added_sugar') || cats.has('indian_sweets_fried') || cats.has('sugar_sweetened_beverage')) return 'sweet';
  if (cats.size) return 'other';
  return 'unknown';
}

function isMixedDish(name) {
  return MIXED_DISH_RE.test(String(name || ''));
}

/**
 * Build a recommended eating order for a meal's components.
 * @param {Array<{name: string, amountG?: number, ingredientId?: string}>} items
 * @param {object} [ctx] - { allergenTerms: Set, avoidNames: Set }
 */
async function sequenceMeal(items, ctx = {}) {
  const prisma = getPrisma();
  const disclaimers = [
    'Eating order is an optional suggestion, not a prescription.',
    'Research on meal sequencing is context-dependent — it does not guarantee any glucose outcome.',
  ];

  if (!Array.isArray(items) || !items.length) {
    return { version: SEQUENCE_VERSION, separable: false, sequencingApplicable: false, reason: 'no_components', order: [], hasMeaningfulFiber: false, suggestedAddition: null, explanation: ['No meal components to order.'], disclaimers, evidence: evidence() };
  }

  // Resolve every component to its ingredient profile (per-100g).
  const catalog = await prisma.ingredientCatalog.findMany({
    select: { normalizedName: true, aliases: true, ingredient: { select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } },
  });
  const byName = new Map();
  for (const c of catalog) {
    if (!c.ingredient?.id) continue;
    for (const k of [c.normalizedName, ...(c.aliases || [])]) if (k && !byName.has(k)) byName.set(k, c.ingredient);
  }
  const resolve = async (it) => {
    if (it.ingredientId) {
      const ing = await prisma.ingredient.findUnique({ where: { id: it.ingredientId }, select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } });
      if (ing) return ing;
    }
    const q = normalize(it.name || it.foodName || '');
    if (!q) return null;
    if (byName.has(q)) return byName.get(q);
    let best = null;
    for (const [key, ing] of byName) {
      const hit = key.startsWith(q) ? 0 : key.includes(q) ? 1 : q.split(' ').every((t) => key.includes(t)) ? 2 : -1;
      if (hit >= 0 && (!best || hit < best.hit || (hit === best.hit && key.length < best.key.length))) best = { hit, key, ing };
    }
    return best?.ing || null;
  };

  const comps = [];
  for (const it of items.slice(0, 12)) {
    const name = String(it.name || it.foodName || '').slice(0, 200);
    const amountG = Number.isFinite(it.amountG) && it.amountG > 0 ? it.amountG : null;
    const ing = await resolve(it);
    const fiberPer100 = ing?.fiberPer100g ?? null;
    // Dry-basis guard: catalog dal/legume entries are dry-weight (e.g. toor dal
    // 15 g/100 g *dry*). Applying that to a logged cooked portion would invent
    // ~2-3x the real fiber. Keep the per-100 g value as provenance but do not
    // multiply a dry basis into an eaten-portion fiberG — report it unknown.
    const dryBasis = /\b(dry|uncooked|split)\b/i.test(String(ing?.name || ''));
    const fiberG = !dryBasis && fiberPer100 != null && amountG != null ? Math.round(fiberPer100 * amountG) / 100 : null;
    comps.push({
      name, amountG, ingredientId: ing?.id || null,
      role: roleFor(it, ing),
      fiberPer100g: fiberPer100, fiberG,
      fiberBasis: dryBasis ? 'dry_weight' : null,
      proteinPer100g: ing?.proteinPer100g ?? null,
      carbsPer100g: ing?.carbsPer100g ?? null,
      mixedDish: isMixedDish(name) || isMixedDish(ing?.name),
      resolved: Boolean(ing),
    });
  }

  // --- Separability ---------------------------------------------------------
  if (comps.length === 1 && comps[0].mixedDish) {
    return done(comps, false, 'mixed_dish_single', 'This looks like a mixed dish — its components can’t realistically be eaten in a set order.', disclaimers);
  }
  if (comps.every((c) => c.mixedDish)) {
    return done(comps, false, 'mixed_dishes', 'These are mixed dishes — ingredient separation would be unrealistic.', disclaimers);
  }

  // --- Rank ------------------------------------------------------------------
  // Tiering: (1) meaningful-fiber non-starchy veg · (2) protein incl. legumes ·
  // (3) starchy carbs last. Fruit/nuts/whole grains: contextual middle —
  // fiber-positive but never auto-first.
  const rank = (c) => {
    const meaningful = (c.fiberG != null && c.fiberG >= MIN_COMPONENT_FIBER_G) || (c.fiberPer100g != null && c.fiberPer100g >= MIN_FIBER_PER_100G);
    if (c.role === 'non_starchy_veg' && meaningful) return 0;
    if (c.role === 'non_starchy_veg') return 1;
    if (c.role === 'legume') return 2;
    if (c.role === 'protein') return 3;
    if (c.role === 'nuts_seeds') return 4;
    if (c.role === 'dairy') return 5;
    if (c.role === 'fruit') return 6;
    if (c.role === 'starch') return 7;
    if (c.role === 'fat') return 8;
    if (c.role === 'sweet') return 9;
    return 6;
  };
  const ordered = [...comps].sort((a, b) => rank(a) - rank(b));
  const order = ordered.map((c, i) => ({ rank: i + 1, component: c.name, role: c.role, roleLabel: ROLE_LABEL[c.role], fiberG: c.fiberG, fiberPer100g: c.fiberPer100g, knownFiber: c.fiberG != null, fiberBasis: c.fiberBasis }));

  const fiberSource = ordered.find((c) => c.role === 'non_starchy_veg' && ((c.fiberG != null && c.fiberG >= MIN_COMPONENT_FIBER_G) || (c.fiberPer100g != null && c.fiberPer100g >= MIN_FIBER_PER_100G)));
  // "Meaningful" = the meal contains a fiber-bearing component. Portion grams
  // may be honestly unknown (dry-basis, unresolved serving) — per-100 g
  // density still tells us the food carries fiber.
  const hasMeaningfulFiber = Boolean(fiberSource) ||
    ordered.some((c) => (c.fiberG ?? 0) >= MIN_COMPONENT_FIBER_G || (c.fiberPer100g ?? 0) >= MIN_FIBER_PER_100G);

  const explanation = [];
  const anyMixed = comps.some((c) => c.mixedDish);
  if (fiberSource) {
    explanation.push(`${fiberSource.name} is your fiber-rich component — having it first, then protein, then most of the starch is a reasonable default order.`);
  } else if (hasMeaningfulFiber) {
    explanation.push('No non-starchy vegetable component stands out, but some components do carry fiber — order below groups fiber-bearing items before the starchiest ones.');
  } else {
    explanation.push('No meaningful fiber source was identified in this meal.');
  }
  if (anyMixed) explanation.push('Mixed dishes in this meal can’t realistically be split — the order below applies only to components you can eat separately.');
  const dryNamed = comps.filter((c) => c.fiberBasis === 'dry_weight').map((c) => c.name);
  if (dryNamed.length) explanation.push(`Fiber values for ${dryNamed.join(', ')} are catalog dry-weight numbers — cooked portions contain less per 100 g, so the gram amount is left unknown rather than estimated.`);

  const suggestedAddition = !hasMeaningfulFiber
    ? (suggestFoods({ preferSequencingFirst: true, allergenTerms: ctx.allergenTerms, avoidNames: ctx.avoidNames, limit: 1 })[0] || null)
    : null;
  if (suggestedAddition) {
    explanation.push(`Consider adding a fiber-rich side such as ${suggestedAddition.food} (${suggestedAddition.serving}, ~${suggestedAddition.approxFiberG} g fiber) — start with it, then protein, then most of your starch.`);
  }

  // sequencingApplicable: machine-readable suppression signal for clients —
  // ordering isolated single-food entries is vacuous (nothing to order), so
  // clients must not render the order UI for them. The food-first addition
  // suggestion remains available independently of ordering.
  const sequencingApplicable = order.length >= 2;
  if (!sequencingApplicable) explanation.push('Only one separable component — there is nothing to order here.');

  return {
    version: SEQUENCE_VERSION,
    separable: true,
    sequencingApplicable,
    reason: anyMixed ? 'partial_mixed' : 'component_meal',
    order,
    hasMeaningfulFiber,
    suggestedAddition,
    explanation,
    disclaimers,
    evidence: evidence(),
  };
}

function done(comps, separable, reason, msg, disclaimers) {
  return { version: SEQUENCE_VERSION, separable, sequencingApplicable: false, reason, order: comps.map((c, i) => ({ rank: i + 1, component: c.name, role: c.role, roleLabel: ROLE_LABEL[c.role], fiberG: c.fiberG, knownFiber: c.fiberPer100g != null })), hasMeaningfulFiber: comps.some((c) => (c.fiberG ?? 0) >= MIN_COMPONENT_FIBER_G), suggestedAddition: null, explanation: [msg], disclaimers, evidence: evidence() };
}

function evidence() {
  return [
    { key: 'MEAL_ORDERING', note: 'Crossover meal-order studies associate eating vegetables/protein before starch with lower post-meal glucose excursions in some populations — effects vary and are not guaranteed.' },
    { key: 'FIBER_COMPOSITION', note: 'Component fiber is computed from per-100 g nutrient profiles; unrecognized items are marked unclassified rather than assumed.' },
  ];
}

// Returns the first mixed-dish term found in free text (for assistant answers).
function mixedDishIn(text) {
  const m = MIXED_DISH_RE.exec(String(text || ''));
  return m ? m[0] : null;
}

module.exports = { sequenceMeal, isMixedDish, mixedDishIn, roleFor, SEQUENCE_VERSION, MIN_COMPONENT_FIBER_G, MIN_FIBER_PER_100G };
