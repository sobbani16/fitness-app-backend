// Deterministic mock of an AI-assisted food detection call.
// Returns a SHORT, STRUCTURED response the mobile app can render
// and (crucially) re-scale once a real portion weight is known.
//
// Swap this for a real vision/LLM call later — shape must stay stable.

const FOOD_DB = [
  { keywords: ['salad', 'mixed salad'],          name: 'Mixed salad',            kcalPer100g: 80,  portion_g: 300, p100: 3,  c100: 6,  f100: 4 },
  { keywords: ['chicken', 'grilled chicken'],    name: 'Grilled chicken breast', kcalPer100g: 165, portion_g: 180, p100: 31, c100: 0,  f100: 4 },
  { keywords: ['burger', 'cheeseburger'],        name: 'Cheeseburger',           kcalPer100g: 295, portion_g: 230, p100: 17, c100: 24, f100: 14 },
  { keywords: ['pizza'],                         name: 'Pizza',                  kcalPer100g: 266, portion_g: 220, p100: 11, c100: 33, f100: 10 },
  { keywords: ['pasta', 'spaghetti'],            name: 'Pasta with sauce',       kcalPer100g: 157, portion_g: 320, p100: 6,  c100: 25, f100: 4 },
  { keywords: ['rice', 'fried rice'],            name: 'Rice',                   kcalPer100g: 130, portion_g: 250, p100: 3,  c100: 28, f100: 0 },
  { keywords: ['sandwich'],                      name: 'Sandwich',               kcalPer100g: 250, portion_g: 200, p100: 12, c100: 28, f100: 10 },
  { keywords: ['oatmeal', 'oats'],               name: 'Oatmeal',                kcalPer100g: 71,  portion_g: 240, p100: 2,  c100: 12, f100: 1 },
  { keywords: ['eggs', 'omelette', 'omelet'],    name: 'Eggs / omelette',        kcalPer100g: 155, portion_g: 150, p100: 13, c100: 1,  f100: 11 },
  { keywords: ['smoothie'],                      name: 'Fruit smoothie',         kcalPer100g: 55,  portion_g: 330, p100: 1,  c100: 12, f100: 0 },
  { keywords: ['yogurt'],                        name: 'Yogurt with fruit',      kcalPer100g: 90,  portion_g: 200, p100: 5,  c100: 14, f100: 2 },
  { keywords: ['apple', 'banana', 'fruit'],      name: 'Fruit',                  kcalPer100g: 52,  portion_g: 150, p100: 0,  c100: 14, f100: 0 },
  { keywords: ['fries'],                         name: 'French fries',           kcalPer100g: 312, portion_g: 150, p100: 3,  c100: 41, f100: 15 },
  { keywords: ['steak'],                         name: 'Steak',                  kcalPer100g: 271, portion_g: 220, p100: 25, c100: 0,  f100: 19 },
  { keywords: ['sushi'],                         name: 'Sushi',                  kcalPer100g: 150, portion_g: 250, p100: 6,  c100: 28, f100: 2 },
  { keywords: ['taco'],                          name: 'Tacos',                  kcalPer100g: 226, portion_g: 200, p100: 10, c100: 20, f100: 11 },
];

const MEAL_TYPE_FALLBACK = {
  breakfast: { name: 'Typical breakfast', kcalPer100g: 180, portion_g: 250, p100: 8,  c100: 24, f100: 6 },
  lunch:     { name: 'Typical lunch',     kcalPer100g: 200, portion_g: 350, p100: 11, c100: 22, f100: 7 },
  dinner:    { name: 'Typical dinner',    kcalPer100g: 210, portion_g: 380, p100: 11, c100: 20, f100: 9 },
  snack:     { name: 'Typical snack',     kcalPer100g: 200, portion_g: 100, p100: 5,  c100: 22, f100: 8 },
};

function round(n) { return Math.round(n); }

/**
 * detectFood({ description, mealType, hasPhoto })
 * Returns:
 *   {
 *     foodName,
 *     caloriesPer100g,
 *     suggestedPortionGrams,
 *     estimatedCalories,        // computed from portion
 *     macrosPer100g: { protein_g, carbs_g, fat_g },
 *     source,
 *     confidence,               // 0..1 — mock
 *     hasPhoto
 *   }
 */
function detectFood({ description, mealType, hasPhoto } = {}) {
  const desc = (description || '').trim().toLowerCase();
  let match = null;
  let matchedBy = null;

  if (desc) {
    for (const f of FOOD_DB) {
      if (f.keywords.some((k) => desc.includes(k))) {
        match = f;
        matchedBy = 'description';
        break;
      }
    }
  }

  if (!match) {
    const t = MEAL_TYPE_FALLBACK[mealType] || MEAL_TYPE_FALLBACK.lunch;
    match = { ...t, keywords: [] };
    matchedBy = mealType ? 'mealType' : 'default';
  }

  const estimatedCalories = round((match.kcalPer100g * match.portion_g) / 100);

  return {
    foodName: match.name,
    caloriesPer100g: match.kcalPer100g,
    suggestedPortionGrams: match.portion_g,
    estimatedCalories,
    macrosPer100g: {
      protein_g: match.p100,
      carbs_g: match.c100,
      fat_g: match.f100,
    },
    source: matchedBy === 'description'
      ? 'matched from description'
      : matchedBy === 'mealType'
      ? `estimated from meal type (${mealType})`
      : 'estimated as a typical lunch',
    confidence: matchedBy === 'description' ? 0.8 : 0.4,
    hasPhoto: Boolean(hasPhoto),
  };
}

module.exports = { detectFood, FOOD_DB, MEAL_TYPE_FALLBACK };
