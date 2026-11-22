// Canonical food-allergen taxonomy + fail-closed recipe/meal assessment.
//
// One vocabulary for every consumer (meal suggestions, recommendations,
// suitability checks, weekly plans). Keys follow the US major food allergens
// (milk, egg, fish, crustacean shellfish, tree nuts, peanuts, wheat, soybeans,
// sesame) plus mustard; users may also save free-text "custom" allergens.
//
// SAFETY CONTRACT
//  - Matching is deliberately conservative: false positives are acceptable,
//    false negatives are not.
//  - Absence of a match is NOT proof of absence. When composition cannot be
//    established (composite/branded ingredients without declared allergens,
//    unresolved lines, cross-contact-prone ingredients, no ingredient list),
//    the result is 'unknown' and callers that surface food to a user with
//    allergies must treat 'unknown' as NOT eligible (fail closed).
//  - Nothing here is a clinical guarantee; copy must keep saying so.

const ALLERGENS = {
  milk: {
    label: 'Milk / dairy',
    names: ['milk', 'dairy', 'lactose', 'cow milk', 'casein', 'whey', 'milk protein'],
    terms: /(?<!coconut |almond |oat |soy |soya |rice |cashew |peanut |cocoa |shea |nut |plant[- ]based |vegan |hemp |coconut-)\b(milk|cheese|cheddar|mozzarella|parmesan|ricotta|feta|paneer|chhena|chenna|butter(?!nut| bean)|ghee|cream(?! of tartar)|yogh?urt|curd|dahi|raita|lassi|chaas|buttermilk|khoa|khoya|mawa|malai|rabri|rabdi|kulfi|kheer|whey|casein|caseinate|lactose|kefir|labneh|condensed|custard|ice cream|bechamel|alfredo|queso|quark|skyr)s?\b/i,
  },
  egg: {
    label: 'Egg',
    names: ['egg', 'eggs', 'egg white', 'egg yolk'],
    terms: /\b(eggs?|egg ?whites?|yolks?|omelet+e?s?|mayo|mayonnaise|aioli|meringue|albumin|frittata|quiche|custard|hollandaise|tamagoyaki|shakshuka|bhurji)\b/i,
  },
  fish: {
    label: 'Fish',
    names: ['fish', 'finfish'],
    terms: /\b(fish|salmon|tuna|cod|tilapia|sardines?|anchov(y|ies)|mackerel|herring|trout|halibut|haddock|pollock|catfish|basa|rohu|catla|pomfret|surmai|seer|kingfish|hilsa|ilish|bangda|bombil|bombay duck|fish sauce|nam pla|worcestershire|dashi|bonito|katsuobushi|caesar)\b/i,
  },
  shellfish: {
    label: 'Crustacean shellfish',
    names: ['shellfish', 'crustacean', 'crustaceans', 'crustacean shellfish', 'prawn', 'prawns', 'shrimp'],
    terms: /\b(shrimps?|prawns?|jhinga|jhinga|kolambi|crabs?|lobsters?|crayfish|crawfish|langoustines?|krill|shellfish|shrimp paste|belacan|kapi)\b/i,
  },
  tree_nuts: {
    label: 'Tree nuts',
    names: ['tree nut', 'tree nuts', 'nut', 'nuts', 'almond', 'cashew', 'walnut', 'pistachio', 'hazelnut', 'pecan', 'macadamia'],
    terms: /\b(almonds?|badam|cashews?|kaju|walnuts?|akhrot|pistachios?|pista|hazelnuts?|filberts?|pecans?|macadamias?|brazil ?nuts?|pine ?nuts?|chilgoza|chironji|charoli|praline|marzipan|nougat|frangipane|pesto|nuts?|mixed nuts|nut butter|gianduja)\b/i,
  },
  peanut: {
    label: 'Peanut',
    names: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'nut', 'nuts'],
    terms: /\b(peanuts?|groundnuts?|moongphali|mungfali|shengdana|kadalai|satay|nuts?|mixed nuts|arachis)\b/i,
  },
  wheat_gluten: {
    label: 'Wheat / gluten',
    names: ['wheat', 'gluten', 'wheat gluten', 'celiac', 'coeliac'],
    terms: /\b(wheat|atta|maida|sooji|suji|semolina|rava|rawa|dalia|daliya|seviyan|sevaiyan|vermicelli|bread(crumbs?)?|buns?|pav|pao|rusk|toast|croutons?|pasta|spaghetti|macaroni|penne|fettuccine|lasagn[ae]|ravioli|gnocchi|noodles?|ramen|udon|couscous|bulgur|freekeh|farro|spelt|barley|jau|rye|malt|seitan|roti|chapati|chapathi|phulka|paratha|parotta|naan|kulcha|bhatura|puri|poori|luchi|samosa|kachori|mathri|tortillas?|pita|wraps?|croissants?|biscuits?|cookies?|cakes?|pastry|pastries|pie|batter|breaded|tempura|panko|soy sauce|shoyu|teriyaki|hoisin|flour|sev|bhujia|dumplings?|momos?|wonton|gyoza|bao|beer)\b/i,
  },
  soy: {
    label: 'Soy',
    names: ['soy', 'soya', 'soybean', 'soybeans'],
    terms: /\b(soy|soya|soybeans?|tofu|edamame|tempeh|miso|natto|tamari|shoyu|teriyaki|hoisin|soy sauce|textured vegetable protein|tvp|lecithin|nutrela|yuba)\b/i,
  },
  sesame: {
    label: 'Sesame',
    names: ['sesame', 'til', 'sesame seed', 'sesame seeds'],
    terms: /\b(sesame|til|gingelly|tahini|tahina|hummus|halva|halwa tahini|gomasio|furikake|za'?atar)\b/i,
  },
  mustard: {
    label: 'Mustard',
    names: ['mustard'],
    terms: /\b(mustard|rai|sarson|kasundi|dijon)\b/i,
  },
};
const KEYS = Object.keys(ALLERGENS);
// Stored Allergy.name per key — plain words so legacy consumers that match on
// the name (trainerNutritionService.matchersForAllergy, supplements/safetyEngine)
// keep working.
const STORED_NAME = { milk: 'milk', egg: 'egg', fish: 'fish', shellfish: 'shellfish', tree_nuts: 'tree nuts', peanut: 'peanut', wheat_gluten: 'wheat gluten', soy: 'soy', sesame: 'sesame', mustard: 'mustard' };

// Composite / prepared ingredients whose allergen content varies by brand or
// recipe. Without a declared allergen list they make composition UNKNOWN.
// Dry spice blends: uncertainty limited to allergens plausibly compounded into them
// (mustard seed, asafoetida-with-wheat, sesame, nuts) — not every allergen.
const SPICE_BLEND = /\b(garam masala|chaat masala|curry powder|sambar powder|rasam powder|pav bhaji masala|chole masala|kitchen king|biryani masala|tandoori masala|panch phoron|spice blend|masala powder)\b/i;
const SPICE_BLEND_ALLERGENS = ['mustard', 'wheat_gluten', 'sesame', 'peanut', 'tree_nuts'];
const COMPOSITE = /\b(sauce|paste|masala|mix|seasoning|blend|spread|dressing|dip|stock|broth|bouillon|gravy|chutney|pickle|achar|relish|ketchup|marinade|curry powder|garam masala|chaat masala|sambar powder|rasam powder|sev|namkeen|bhujia|mixture|chips|crisps|biscuit|cookie|cake|bread|bun|wrap|tortilla|noodle|pasta|sausage|nugget|patty|processed|ready[- ]?made|instant|packaged|brand|imitation|vegan cheese|protein powder|supplement|bar|cereal|granola|muesli|chocolate|candy|ice cream|frozen dessert|restaurant|takeout|fast food)\b/i;
// Ingredients with well-known cross-contact / compounding uncertainty.
const CROSS_CONTACT = {
  wheat_gluten: /\b(oats?|oatmeal|porridge oats|asafoetida|hing|soy sauce)\b/i,
  tree_nuts: /\b(chocolate|granola|muesli|baklava|biscotti)\b/i,
  peanut: /\b(chocolate|granola|muesli|satay|chikki)\b/i,
  sesame: /\b(bun|bagel|naan)\b/i,
};
const TRIVIAL = /^(water|ice|salt|table salt|sea salt|rock salt|black salt|kala namak|sugar|jaggery|baking soda|black pepper|pepper)$/i;

const norm = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// "Peanuts", "tree-nuts", "Dairy allergy", "dairy-free", "nut_free" → canonical keys.
// Unknown strings return [] (callers keep them as custom allergens, never drop).
function canonicalize(name) {
  let n = norm(name).replace(/\b(allergy|allergies|allergic|intolerance|sensitivity|free)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return [];
  if (KEYS.includes(n.replace(/ /g, '_'))) return [n.replace(/ /g, '_')];
  const hits = KEYS.filter(k => ALLERGENS[k].names.some(v => v === n || `${v}s` === n || v === `${n}s`));
  return hits;
}

function normalizeAllergyList(input) {
  const keys = new Set(), custom = new Set();
  for (const raw of input || []) {
    const name = typeof raw === 'string' ? raw : raw?.key || raw?.name || raw?.custom;
    const c = canonicalize(name);
    if (c.length) c.forEach(k => keys.add(k));
    else if (norm(name)) custom.add(norm(name));
  }
  return { keys: [...keys].sort(), custom: [...custom].sort() };
}

// Allergens explicitly declared by a source (catalog free text, Recipe.allergens).
function declaredKeys(values) {
  const out = new Set();
  for (const v of [].concat(values || [])) for (const part of String(v || '').split(/[;,/]| and /)) {
    if (/may contain|traces|check menu|in some preparations/i.test(part)) continue;
    for (const k of canonicalize(part)) out.add(k);
    for (const k of KEYS) if (ALLERGENS[k].terms.test(part)) out.add(k);
  }
  return [...out];
}

function textHits(text) {
  const t = ` ${norm(text)} `;
  return KEYS.filter(k => ALLERGENS[k].terms.test(t));
}

/**
 * Assess one food item (recipe, AI meal, label) against a user's allergens.
 * @param {object} item
 *   name: dish name; lines: [{ name, resolved?: bool, declared?: string[] | null, composite?: bool }]
 *   declared: item-level declared allergens (e.g. Recipe.allergens); text: extra free text (label ingredients)
 * @param {{keys:string[], custom:string[]}} user  normalized allergies
 * @returns {{status:'clear'|'conflict'|'unknown'|'not_applicable', conflicts:[{allergen,evidence}], unknown:[{allergen,reason}]}}
 */
function assess(item, user) {
  const keys = user?.keys || [], custom = user?.custom || [];
  if (!keys.length && !custom.length) return { status: 'not_applicable', conflicts: [], unknown: [] };
  const lines = Array.isArray(item.lines) ? item.lines : [];
  const conflicts = [], unknown = [];
  const allText = [item.name, item.text, ...lines.map(l => l.name)].filter(Boolean).join(' | ');
  const declared = new Set(declaredKeys(item.declared));
  for (const l of lines) for (const k of declaredKeys(l.declared)) declared.add(k);
  const found = new Set([...textHits(allText), ...declared]);
  for (const k of keys) if (found.has(k)) conflicts.push({ allergen: k, evidence: declared.has(k) ? 'declared' : 'ingredient_name' });
  for (const c of custom) if (new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(norm(allText))) conflicts.push({ allergen: c, evidence: 'ingredient_name' });
  if (!conflicts.length) {
    const all = [...keys, ...custom];
    if (!lines.length && !item.text) for (const a of all) unknown.push({ allergen: a, reason: 'no_ingredient_list' });
    for (const l of lines) {
      if (TRIVIAL.test(norm(l.name))) continue;
      const hasDecl = Array.isArray(l.declared) ? l.declared.length > 0 : !!l.declared;
      if (l.resolved === false) for (const a of all) unknown.push({ allergen: a, reason: `unresolved_ingredient:${l.name}` });
      else if (!hasDecl && SPICE_BLEND.test(norm(l.name)) && !l.composite) { for (const a of all) if (!KEYS.includes(a) || SPICE_BLEND_ALLERGENS.includes(a)) unknown.push({ allergen: a, reason: `spice_blend_composition_unknown:${l.name}` }); }
      else if ((l.composite || COMPOSITE.test(norm(l.name))) && !hasDecl) for (const a of all) unknown.push({ allergen: a, reason: `composite_without_declared_allergens:${l.name}` });
    }
    for (const k of keys) if (CROSS_CONTACT[k]?.test(` ${norm(allText)} `)) unknown.push({ allergen: k, reason: 'cross_contact_risk' });
  }
  const dedup = arr => [...new Map(arr.map(x => [`${x.allergen}|${x.reason || x.evidence}`, x])).values()];
  return { status: conflicts.length ? 'conflict' : unknown.length ? 'unknown' : 'clear', conflicts: dedup(conflicts), unknown: dedup(unknown) };
}

// ---- DB helpers ------------------------------------------------------------
async function loadUserAllergies(prisma, userId) {
  const rows = await prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } });
  return normalizeAllergyList(rows.map(r => r.allergy?.name).filter(Boolean));
}

// Ingredient-id → { declared, composite } from the catalog record.
async function ingredientAllergenInfo(prisma, ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await prisma.ingredient.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, catalog: { select: { sourceRecord: true, foodType: true, brand: true, restaurantChain: true } } } });
  return new Map(rows.map(i => {
    const sr = i.catalog?.sourceRecord || {};
    const declared = sr.allergens ? [String(sr.allergens)] : [];
    const composite = !!(i.catalog?.brand || i.catalog?.restaurantChain || /sauce|condiment|brand|restaurant|prepared|supplement|powder|spread|cereal/i.test(i.catalog?.foodType || ''));
    return [i.id, { name: i.name, declared, composite }];
  }));
}

// Build an assess() item from a Recipe row (+ its RecipeIngredient lines).
function recipeItem(recipe, info = new Map()) {
  const usda = Array.isArray(recipe.nutritionSource?.ingredients) ? recipe.nutritionSource.ingredients : null;
  const lines = (recipe.ingredients || []).map(l => {
    const i = l.ingredientId ? info.get(l.ingredientId) : null;
    const knownFromProvenance = !l.ingredientId && usda?.some(x => x.description === l.ingredientName);
    return { name: l.ingredientName, resolved: !!i || knownFromProvenance || TRIVIAL.test(norm(l.ingredientName)), declared: i?.declared || null, composite: i?.composite || false };
  });
  return { name: recipe.recipeName, declared: recipe.allergens || [], lines };
}

const ELIGIBLE = s => s === 'clear' || s === 'not_applicable';

module.exports = { ALLERGENS, KEYS, STORED_NAME, canonicalize, normalizeAllergyList, declaredKeys, textHits, assess, loadUserAllergies, ingredientAllergenInfo, recipeItem, ELIGIBLE, norm };
