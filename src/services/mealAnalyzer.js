// Mock meal analyzer — deterministic, rule-based.
// Replaces a real vision/LLM call for the MVP.
// Strategy:
//   1. Try to match known keywords in the description to a food entry.
//   2. Else fall back to mealType averages.
//   3. Feedback is a short canned string based on calorie band.
//
// Keep calories conservative / typical per serving.

const FOODS = [
  { keywords: ['salad'], name: 'Mixed salad', kcal: 250, p: 10, c: 15, f: 15 },
  { keywords: ['chicken', 'grilled chicken'], name: 'Grilled chicken plate', kcal: 520, p: 45, c: 35, f: 18 },
  { keywords: ['burger', 'cheeseburger'], name: 'Cheeseburger', kcal: 720, p: 35, c: 50, f: 40 },
  { keywords: ['pizza'], name: 'Pizza (2 slices)', kcal: 600, p: 25, c: 70, f: 22 },
  { keywords: ['pasta', 'spaghetti'], name: 'Pasta with sauce', kcal: 550, p: 18, c: 80, f: 16 },
  { keywords: ['rice', 'fried rice'], name: 'Rice bowl', kcal: 450, p: 15, c: 75, f: 10 },
  { keywords: ['sandwich'], name: 'Sandwich', kcal: 480, p: 22, c: 55, f: 18 },
  { keywords: ['oatmeal', 'oats'], name: 'Oatmeal', kcal: 300, p: 10, c: 55, f: 6 },
  { keywords: ['eggs', 'omelette', 'omelet'], name: 'Eggs / omelette', kcal: 380, p: 22, c: 6, f: 28 },
  { keywords: ['smoothie'], name: 'Fruit smoothie', kcal: 280, p: 8, c: 55, f: 3 },
  { keywords: ['yogurt'], name: 'Yogurt with fruit', kcal: 220, p: 12, c: 30, f: 6 },
  { keywords: ['apple', 'banana', 'fruit'], name: 'Fruit', kcal: 95, p: 1, c: 25, f: 0 },
  { keywords: ['coffee', 'latte'], name: 'Latte', kcal: 150, p: 8, c: 14, f: 6 },
  { keywords: ['soda', 'coke'], name: 'Soda', kcal: 150, p: 0, c: 39, f: 0 },
  { keywords: ['fries'], name: 'Fries', kcal: 380, p: 4, c: 48, f: 19 },
  { keywords: ['steak'], name: 'Steak', kcal: 650, p: 55, c: 2, f: 45 },
  { keywords: ['sushi'], name: 'Sushi (8 pcs)', kcal: 420, p: 18, c: 65, f: 8 },
  { keywords: ['taco'], name: 'Tacos (2)', kcal: 480, p: 22, c: 45, f: 22 },
];

const MEAL_TYPE_FALLBACK = {
  breakfast: { name: 'Typical breakfast', kcal: 400, p: 18, c: 50, f: 14 },
  lunch:     { name: 'Typical lunch',     kcal: 650, p: 30, c: 70, f: 22 },
  dinner:    { name: 'Typical dinner',    kcal: 700, p: 35, c: 65, f: 28 },
  snack:     { name: 'Typical snack',     kcal: 200, p: 6,  c: 25, f: 8  },
};

function analyzeMeal({ description, mealType, hasPhoto } = {}) {
  const desc = (description || '').trim().toLowerCase();
  let match = null;

  if (desc) {
    for (const f of FOODS) {
      if (f.keywords.some((k) => desc.includes(k))) {
        match = f;
        break;
      }
    }
  }

  const matched = Boolean(match);
  if (!match) {
    const t = MEAL_TYPE_FALLBACK[mealType] || MEAL_TYPE_FALLBACK.lunch;
    match = { ...t };
  }

  const source = matched
    ? 'matched from description'
    : mealType
    ? `estimated from meal type (${mealType})`
    : 'estimated as a typical lunch';

  return {
    name: match.name,
    calories: match.kcal,
    macros: { protein_g: match.p, carbs_g: match.c, fat_g: match.f },
    feedback: buildFeedback(match.kcal, mealType),
    source,
    hasPhoto: Boolean(hasPhoto),
  };
}

function buildFeedback(kcal, mealType) {
  if (kcal >= 700) {
    return 'Hearty portion — aim for a lighter next meal and drink water before seconds.';
  }
  if (kcal >= 500) {
    return 'Solid meal. Balance it with some vegetables and a short walk afterwards.';
  }
  if (kcal >= 300) {
    return 'Moderate meal — good pacing. Add protein if you still feel hungry.';
  }
  if (mealType === 'snack') {
    return 'Light snack. Pair with water to stay full longer.';
  }
  return 'Light meal — consider adding protein or complex carbs if this is a main meal.';
}

module.exports = { analyzeMeal, FOODS, MEAL_TYPE_FALLBACK };
