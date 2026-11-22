// Food-first fiber suggestions — deterministic catalog.
//
// Every entry carries a realistic serving and an approximate fiber value from
// standard composition data (USDA FDC typical values, rounded). These are
// display aids, not precision measurements — the payload says so.
// ALL entries are plant foods; diet-style filtering exists for completeness
// and for allergen/dislike screening, which is a hard filter.
//
// `classes`:
//   non_starchy_veg — sequencing-first candidates
//   legume          — fiber+protein; sequencing requires context evaluation
//   whole_grain     — context-dependent (still a carb source)
//   fruit           — context-dependent
//   nuts_seeds      — context-dependent
// `mealFit` — which meal occasions the food realistically suits.

const FIBER_FOODS = [
  { name: 'broccoli', classes: ['non_starchy_veg'], serving: '1 cup cooked (~150 g)', fiberG: 5, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'cabbage sabzi / cooked cabbage', classes: ['non_starchy_veg'], serving: '1 katori cooked (~100 g)', fiberG: 2.5, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'spinach / palak', classes: ['non_starchy_veg'], serving: '1 cup cooked (~180 g)', fiberG: 4, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'green beans', classes: ['non_starchy_veg'], serving: '1 cup cooked (~125 g)', fiberG: 4, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'cauliflower', classes: ['non_starchy_veg'], serving: '1 cup cooked (~125 g)', fiberG: 3, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'okra / bhindi', classes: ['non_starchy_veg'], serving: '1 cup cooked (~100 g)', fiberG: 3, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'carrot', classes: ['non_starchy_veg'], serving: '1 medium raw (~60 g)', fiberG: 1.7, mealFit: ['breakfast', 'lunch', 'dinner', 'snack'], allergenTerms: [] },
  { name: 'cucumber + tomato salad', classes: ['non_starchy_veg'], serving: '1 katori (~150 g)', fiberG: 1.5, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'dal (cooked lentils)', classes: ['legume'], serving: '1 katori (~100 g)', fiberG: 4, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'chickpeas / chole', classes: ['legume'], serving: '1 katori (~100 g)', fiberG: 6, mealFit: ['lunch', 'dinner', 'snack'], allergenTerms: [] },
  { name: 'rajma (kidney beans)', classes: ['legume'], serving: '1 katori (~100 g)', fiberG: 6, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'black chana', classes: ['legume'], serving: '1 katori boiled (~100 g)', fiberG: 6, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'hummus', classes: ['legume'], serving: '2 tbsp (~30 g)', fiberG: 2, mealFit: ['snack', 'lunch'], allergenTerms: ['sesame'] },
  { name: 'oats (rolled)', classes: ['whole_grain'], serving: '40 g dry (~1/2 cup)', fiberG: 4, mealFit: ['breakfast'], allergenTerms: ['gluten'] },
  { name: 'whole-wheat roti', classes: ['whole_grain'], serving: '1 roti (~30 g)', fiberG: 2, mealFit: ['lunch', 'dinner'], allergenTerms: ['gluten', 'wheat'] },
  { name: 'brown rice', classes: ['whole_grain'], serving: '1 cup cooked (~150 g)', fiberG: 2.5, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'whole-grain bread', classes: ['whole_grain'], serving: '1 slice (~30 g)', fiberG: 2, mealFit: ['breakfast', 'snack'], allergenTerms: ['gluten', 'wheat'] },
  { name: 'millets (ragi/jowar/bajra roti)', classes: ['whole_grain'], serving: '1 roti (~30 g)', fiberG: 3, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
  { name: 'apple', classes: ['fruit'], serving: '1 medium (~180 g)', fiberG: 4, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'pear', classes: ['fruit'], serving: '1 medium (~180 g)', fiberG: 5.5, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'guava', classes: ['fruit'], serving: '1 medium (~100 g)', fiberG: 5, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'orange', classes: ['fruit'], serving: '1 medium (~130 g)', fiberG: 3, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'papaya', classes: ['fruit'], serving: '1 cup (~140 g)', fiberG: 2.5, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'berries (mixed)', classes: ['fruit'], serving: '1 cup (~150 g)', fiberG: 6, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'chia seeds', classes: ['nuts_seeds'], serving: '1 tbsp (~12 g)', fiberG: 4, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'ground flaxseed', classes: ['nuts_seeds'], serving: '1 tbsp (~10 g)', fiberG: 3, mealFit: ['breakfast', 'snack'], allergenTerms: [] },
  { name: 'almonds', classes: ['nuts_seeds'], serving: '~23 nuts (28 g)', fiberG: 3.5, mealFit: ['snack', 'breakfast'], allergenTerms: ['almond', 'tree nut', 'nut'] },
  { name: 'roasted chana', classes: ['legume', 'nuts_seeds'], serving: '30 g handful', fiberG: 5, mealFit: ['snack'], allergenTerms: [] },
  { name: 'sweet potato (baked)', classes: ['non_starchy_veg'], serving: '1 medium (~130 g)', fiberG: 4, mealFit: ['lunch', 'dinner'], allergenTerms: [] },
];

// Deterministic fiber-add suggestions for a daily gap.
// `ctx`:
//   gapG         — remaining grams to cover (required to pick sensible sizes)
//   mealType     — upcoming occasion filter (optional)
//   preferSequencingFirst — bias to non-starchy veg
//   allergenTerms — Set of lowercase allergen terms (server-loaded)
//   avoidNames    — Set of lowercased food names the user marked DISLIKE/NEVER_RECOMMEND
//   limit         — max suggestions (default 4)
function suggestFoods({ gapG = null, mealType = null, preferSequencingFirst = false, allergenTerms = new Set(), avoidNames = new Set(), limit = 4 } = {}) {
  const blocked = (food) => {
    if (food.allergenTerms.some((t) => [...allergenTerms].some((a) => a && (food.name.toLowerCase().includes(String(a).toLowerCase()) || t.includes(String(a).toLowerCase()))))) return true;
    return [...avoidNames].some((n) => n && food.name.toLowerCase().includes(String(n).toLowerCase()));
  };
  let pool = FIBER_FOODS.filter((f) => !blocked(f));
  if (mealType) {
    const fit = pool.filter((f) => f.mealFit.includes(mealType));
    if (fit.length) pool = fit;
  }
  const score = (f) => {
    let s = f.fiberG;
    if (preferSequencingFirst && f.classes.includes('non_starchy_veg')) s += 3;
    // For a small remaining gap, prefer smaller realistic adds over dumping a
    // huge serving; for a large gap, prefer high-fiber staples.
    if (gapG != null) {
      if (gapG <= 6 && f.fiberG <= 5) s += 1;
      if (gapG > 10 && f.fiberG >= 5) s += 1.5;
    }
    return s;
  };
  const picked = [...pool].sort((a, b) => score(b) - score(a)).slice(0, limit);
  return picked.map((f) => ({
    food: f.name,
    serving: f.serving,
    approxFiberG: f.fiberG,
    classes: f.classes,
    note: f.classes.includes('non_starchy_veg')
      ? 'Non-starchy vegetable — also works as an eat-first side.'
      : `Approximate value from standard composition data — actual fiber varies.`,
  }));
}

module.exports = { FIBER_FOODS, suggestFoods };
