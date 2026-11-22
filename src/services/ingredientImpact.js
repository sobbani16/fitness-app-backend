// Ingredient Impact Intelligence (Sprint C) — deterministic, goal-aware
// portion/budget evaluation + substitution policy. Rules:
//   - No food is classified "harmful" for containing calories or fat.
//   - Concerns are labeled by dimension: portion | pattern | composition —
//     never a moralized food judgment.
//   - Unknown nutrients stay unknown (added sugar/sodium/satfat → 'unverified').
//   - Substitutions require caller-provided allergen terms; no unreviewed
//     medical-condition swaps; composition gaps never claim safety.
//   - Evidence references are citations for the *pattern-level* education,
//     not per-number claims.
const round = (x) => Math.round(x * 10) / 10;

// Canonical category taxonomy. `nutrientFocus` = the nutrients the category's
// education is about. `portionSensitive`/`patternSensitive` drive which
// concern dimensions may fire. `goalApplicability` = goals where education
// is relevant (empty = all goals).
const CATEGORIES = {
  added_sugar: { focus: ['addedSugarG', 'calories'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss', 'maintenance', 'body_recomposition'], evidence: 'WHO free-sugars guideline (<10% energy; conditional <5%)', note: 'Free/added sugar guidance is about frequency and total share — not a single-food ban.' },
  sugar_sweetened_beverage: { focus: ['calories'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss', 'maintenance'], evidence: 'WHO SSB guidance; liquid calories show weak satiety compensation', note: 'Liquid calories are easy to under-count — portion and frequency both matter.' },
  refined_carb: { focus: ['carbsG', 'fiberG'], portion: true, pattern: true, goals: [], evidence: 'General dietary-pattern guidance (DGA/WHO)', note: 'Refined starches fit plans; fiber-poor patterns are the pattern-level concern.' },
  whole_grain: { focus: ['fiberG', 'carbsG'], portion: false, pattern: true, goals: [], evidence: 'DGA whole-grain ≥half-of-grains guidance', note: 'Whole grains support fiber targets — a positive inclusion, not a score bonus.' },
  saturated_fat_food: { focus: ['fatG'], portion: true, pattern: true, goals: [], evidence: 'AHA saturated-fat <10% energy guidance', note: 'Portion and pattern level only; requires verified saturated-fat data to compute.' },
  nuts_seeds: { focus: ['calories', 'fatG', 'proteinG', 'fiberG'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss'], evidence: 'Nut-density literature — nutritious but calorie-dense per gram', note: 'Portion size is the lever, not the food — nuts provide beneficial fats, fiber, protein.' },
  dairy_paneer_cream: { focus: ['calories', 'fatG', 'proteinG'], portion: true, pattern: true, goals: [], evidence: 'Protein value + fat-density trade-off', note: 'Preparation method (cream/ghee) changes the profile more than the paneer itself.' },
  legumes_soy: { focus: ['proteinG', 'fiberG', 'carbsG'], portion: false, pattern: true, goals: [], evidence: 'Legume protein+fiber contributions', note: 'Useful protein and fiber source across vegetarian and mixed diets.' },
  protein_foods: { focus: ['proteinG', 'calories'], portion: false, pattern: true, goals: ['muscle_gain', 'weight_gain', 'bulking'], evidence: 'Protein adequacy for training adaptation', note: 'Protein foods support gain goals — total-day intake is what matters.' },
  processed_meat_snack: { focus: ['sodium', 'calories', 'fatG'], portion: true, pattern: true, goals: [], evidence: 'WHO/IARC processed-meat advisory; sodium guidance', note: 'Pattern frequency is the evidence-based concern; sodium often unverified in data.' },
  sodium_rich: { focus: ['sodium'], portion: true, pattern: true, goals: [], evidence: 'WHO <2g sodium/day guidance', note: 'Sodium is frequently unrecorded — unverified stays unverified, never zero.' },
  cooking_fat: { focus: ['fatG', 'calories'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss'], evidence: 'Added-fat calorie density (9 kcal/g)', note: 'Measured amounts matter — oil quantities are a common logging gap.' },
  indian_sweets_fried: { focus: ['calories', 'carbsG', 'fatG'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss'], evidence: 'Calorie density of fried/syrup-sweetened preparations', note: 'Occasional festive foods fit plans — frequency and portion are the honest frame.' },
  fruit_vegetable: { focus: ['fiberG', 'calories'], portion: false, pattern: true, goals: [], evidence: 'F&V intake guidance', note: 'Positive inclusion supporting fiber and micronutrient coverage.' },
  beverage_caloric: { focus: ['calories'], portion: true, pattern: true, goals: ['weight_loss', 'fat_loss'], evidence: 'Liquid-calorie contribution', note: 'Same liquid-calorie caveat as SSBs.' },
};

// Goal-aware concern evaluation. `meal` = {calories, proteinG, carbsG, fatG,
// fiberG, quantityG, foodName, categoryId?}; `goal` canonical; `targets` =
// MacroGoal row fields. Returns portion-budget shares + labeled concern dims.
function evaluatePortion({ meal = {}, goal = 'maintenance', targets = {}, categoryId = null }) {
  const kcal = meal.calories ?? null, g = meal.quantityG ?? null;
  const target = targets.caloriesTarget ?? null;
  const share = (kcal != null && target) ? round(kcal / target * 100) : null;
  const cat = categoryId && CATEGORIES[categoryId] ? CATEGORIES[categoryId] : null;
  const dimensions = [];
  if (share != null && share >= 30 && cat?.portion) dimensions.push({ dimension: 'portion', sharePct: share, note: `This portion provides about ${share}% of a ${target}-kcal daily target.` });
  const out = {
    goal, categoryId: cat ? categoryId : null,
    portion: { quantityG: g, calories: kcal, shareOfDailyTargetPct: share },
    nutrients: {
      proteinG: meal.proteinG ?? null, carbsG: meal.carbsG ?? null, fatG: meal.fatG ?? null, fiberG: meal.fiberG ?? null,
      addedSugarG: 'unverified', saturatedFatG: 'unverified', sodiumMg: 'unverified', // not in FoodLog — unknown ≠ zero
    },
    dimensions,
    verdict: share == null ? 'INCOMPLETE_DATA' : share >= 40 ? 'large_portion' : share >= 20 ? 'moderate_portion' : 'small_portion',
    education: cat ? { evidence: cat.evidence, note: cat.note, portionSensitive: cat.portion, patternSensitive: cat.pattern } : null,
    disclaimer: 'Educational information — portion fit vs your selected targets. Not a food judgment or medical advice.',
  };
  return out;
}

// Deterministic substitution policy. `allergenTerms` must come from the
// caller's server-side constraint load — never trust client-passed lists.
// No medical-condition swaps; unknown composition → 'composition_unverified'.
function suggestSubstitutions({ meal = {}, goal, categoryId = null, allergenTerms = new Set() }) {
  const name = String(meal.foodName || '').toLowerCase();
  const blocked = (t) => [...allergenTerms].some((a) => a && t.includes(String(a).toLowerCase()));
  const subs = [];
  const push = (swap) => { if (!blocked(swap.item.toLowerCase())) subs.push(swap); };
  if (categoryId === 'nuts_seeds' && (meal.quantityG || 0) >= 40) push({ item: 'same food, smaller portion (~25–30g)', kind: 'portion', trade: { calories: `−${round((meal.quantityG - 28) * (meal.calories || 0) / meal.quantityG)} kcal`, proteinG: 'similar', effort: 'none', cuisineFit: 'identical' } });
  if (categoryId === 'sugar_sweetened_beverage') push({ item: 'unsweetened or reduced-sugar version of the same drink', kind: 'preparation', trade: { calories: 'lower', proteinG: 'same', effort: 'none' } });
  if (categoryId === 'cooking_fat') push({ item: 'measured smaller amount of the same oil/ghee', kind: 'portion', trade: { fatG: 'lower', calories: 'lower', effort: 'measuring spoon' } });
  if (categoryId === 'indian_sweets_fried') push({ item: 'smaller portion of the same sweet', kind: 'portion', trade: { calories: 'lower', effort: 'none' } });
  if (['muscle_gain', 'weight_gain', 'bulking'].includes(goal) && (meal.proteinG || 0) < 15) {
    for (const add of ['greek yogurt', 'dal/legume side', 'eggs', 'paneer (lean preparation)']) push({ item: `${add} added to this meal`, kind: 'addition', trade: { proteinG: 'higher', calories: 'higher', cuisineFit: 'indian+international' } });
  }
  if ((meal.fiberG ?? null) != null && meal.fiberG < 3) push({ item: 'vegetable or fruit side with this meal', kind: 'addition', trade: { fiberG: 'higher', effort: 'low' } });
  return {
    goal, categoryId, substitutions: subs.slice(0, 3),
    safety: { allergensScreened: [...allergenTerms].length, composition: subs.length ? 'screened_for_name_terms_only — verify full ingredient composition' : null, medicalConditionSwaps: 'not_provided_unreviewed' },
    disclaimer: 'Substitutions are educational options, not restrictions — the original food is not "bad".',
  };
}

// Phase 1 — deterministic multi-label classification. Evidence ladder:
//   VERIFIED (verified profile per-100g nutrients) →
//   DERIVED_FROM_VERIFIED_DATA (band rules over those nutrients) →
//   ESTIMATED (name/culinary-role hints only) → UNKNOWN (no usable data).
// Identity hints never override nutrient-derived labels; bands are
// documented engineering thresholds, not clinical cutoffs.
const CLASSIFY_VERSION = 'classify-v1';
function classifyFood({ name = '', per100 = {}, culinaryRole = null }) {
  const labels = new Set();
  const basis = { nutrientDerived: [], nameHints: [] };
  const kcal = per100.calories, pro = per100.proteinG, fat = per100.fatG, fib = per100.fiberG;
  const n = String(name).toLowerCase();
  if (kcal != null) {
    if (kcal >= 450) { labels.add('calorie_dense'); basis.nutrientDerived.push('kcal/100g≥450'); }
    if (kcal <= 80 && fib != null && fib >= 2) { labels.add('fruit_vegetable'); basis.nutrientDerived.push('low-kcal+fiber'); }
  }
  if (pro != null && pro >= 18) { labels.add('protein_foods'); basis.nutrientDerived.push('protein≥18g/100g'); }
  // Cooking fats are nearly pure fat — nuts also hit fat≥45 but carry
  // protein+fiber, so the band requires near-zero protein/fiber.
  if (fat != null && fat >= 45 && (pro == null || pro < 3) && (fib == null || fib < 2)) { labels.add('cooking_fat'); basis.nutrientDerived.push('fat≥45g/100g,~0 protein+fiber'); }
  // Legumes are protein+fiber-dense AND nearly fat-free (fat≤2/100g separates
  // them from breads and nuts — rye bread fiber5.8/pro8.5 was a real collision).
  if (fib != null && fib >= 5 && pro != null && pro >= 10 && (fat == null || fat <= 2)) { labels.add('legumes_soy'); basis.nutrientDerived.push('fiber≥5+protein≥10+fat≤2'); }
  // Name/culinary-role hints — recorded separately, lower evidence tier.
  const hints = [
    [/\b(almond|walnut|cashew|pistachio|peanut|chia|flax|sesame|sunflower seed|pumpkin seed)s?\b/, 'nuts_seeds'],
    [/\b(ghee|butter|oil|margarine|shortening|lard|vanaspati)\b/, 'cooking_fat'],
    [/\b(paneer|cheese|cream|curd|yogurt|dahi|milk|khoya|malai)\b/, 'dairy_paneer_cream'],
    [/\b(gulab jamun|jalebi|laddu|ladoo|barfi|halwa|kheer|rasgulla|peda|mysore pak)\b/, 'indian_sweets_fried'],
    [/\b(soda|cola|soft drink|juice|sweet lassi|energy drink|sweetened chai|sherbet)\b/, 'sugar_sweetened_beverage'],
    [/\b(samosa|pakora|bhujia|chips|namkeen|fried)\b/, 'indian_sweets_fried'],
    [/\b(bacon|sausage|salami|ham|pepperoni|jerky|processed meat)\b/, 'processed_meat_snack'],
    [/\b(dal|lentil|chickpea|chana|rajma|beans|tofu|soy)\b/, 'legumes_soy'],
    [/\b(brown rice|oats|quinoa|whole[-\s]?wheat|atta|millet|ragi|jowar|bajra)\b/, 'whole_grain'],
    [/\b(white rice|maida|refined|white bread|maida roti)\b/, 'refined_carb'],
    [/\b(soy sauce|pickle|achaar|papad|salt)\b/, 'sodium_rich'],
    [/\b(sugar|jaggery|honey|syrup|molasses|treacle|candy)\b/, 'added_sugar'],
    [/\b(chicken|fish|egg|mutton|beef|pork|turkey|prawn|salmon)\b/, 'protein_foods'],
  ];
  for (const [re, cat] of hints) if (re.test(n)) { labels.add(cat); basis.nameHints.push(cat); }
  const state = labels.size === 0
    ? (kcal == null && pro == null ? 'UNKNOWN' : 'ESTIMATED')
    : basis.nutrientDerived.length ? 'DERIVED_FROM_VERIFIED_DATA' : 'ESTIMATED';
  return { version: CLASSIFY_VERSION, categories: [...labels], ...basis, state, note: 'classification is nutritional/culinary labeling — never a health verdict' };
}

module.exports = { CATEGORIES, evaluatePortion, suggestSubstitutions, classifyFood, CLASSIFY_VERSION };
