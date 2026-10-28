// Deterministic document classification for scanned text. No LLM.
// Signals: nutrient field density, label units/structures, menu price
// patterns, meal-section vocabulary, and line-shape (dish | price).
// Never relies on a single keyword.

const NUTRIENT_FIELDS = [
  /calories|energy\b|kj\b|kcal/i,
  /protein/i,
  /carbohydrate|carbs\b/i,
  /total fat|fat\s*$/im,
  /saturated|saturates/i,
  /trans fat/i,
  /cholesterol/i,
  /sodium/i,
  /fiber|fibre/i,
  /sugars?\b/i,
  /added sugars?/i,
  /vitamin|calcium|iron|potassium/i,
];
const LABEL_STRUCTURES = [
  /nutrition (facts|information)/i,
  /per\s*100\s*(g|ml|gm)\b/i,
  /per\s*serv(e|ing)\b/i,
  /serving size|servings per (container|pack)|serves?\s*\d/i,
  /%.*(daily value|dv|rda|sugar reference)/i,
  /reference intake|nutritional info/i,
  /amount per serving|about\s*\d+\s*servings/i,
];
const MENU_PRICE = /(?:rs\.?|inr|usd|\$|₹|€|£)\s?\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:rs\.?|inr|₹)/i;
const MENU_SECTIONS = [
  /appetizers?|starters?|entrees?|mains?\b|main course/i,
  /desserts?|beverages?|drinks?\b|cocktails?|mocktails?/i,
  /breakfast|brunch|lunch|dinner|specials?/i,
  /veg(etarian)?\s+(and|&)\s+non.?veg|non.?vegetarian/i,
  /biryani|curry|tikka|dosa|paneer|naan|roti|dal\s/i,
  /side dishes|sides|soups?|salads?|wraps?|pizza|pasta|grill/i,
];
const VEHICLE_PATTERNS = [
  /visa|passport|embassy|application (number|id)|date of issue|expiry date/i,
  /invoice|receipt|order number|tracking|shipment|deliver/i,
  /rental|lease|mortgage|insurance|policy number|premium/i,
  /employee|payroll|payslip|salary|tax|gstin|gst no/i,
  /boarding pass|flight|gate|seat|departure|arrival|pnr/i,
  /terms and conditions|privacy policy|warranty|license agreement/i,
  /prescription|rx\b|dosage|tablet|capsule|mg daily/i,
  /bank statement|account number|ifsc|swift|balance/i,
];
const FOOD_PACKAGING = [
  /ingredients?[: ]/i,
  /allergen|contains[:\s]|may contain|free from/i,
  /best before|expiry|mfg\.?|manufactured|packaged by|marketed by/i,
  /net (weight|wt|quantity)|net qty|volume/i,
  /vegetarian|non-vegetarian|vegan|fssai|f\.?ssai/i,
  /batch|lot no|imported|distributor/i,
];

function countMatches(text, patterns) {
  let n = 0;
  for (const p of patterns) if (p.test(text)) n += 1;
  return n;
}

// Lines that look like "Dish name ..... 199" or "Paneer Tikka - grilled ... ₹320"
function priceShapedLines(lines) {
  let n = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 60 && !MENU_PRICE.test(trimmed)) continue;
    if (MENU_PRICE.test(trimmed)) n += 1;
  }
  return n;
}

// Counts nutrient-styled lines "Calories 180" or "Protein 4g".
function nutrientLines(lines) {
  let n = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^(calories|energy|protein|total\s+carbohydrate|carbs?|total\s+fat|saturated|trans\s+fat|cholesterol|sodium|fiber|fibre|sugars?|added sugars?|vitamin|calcium|iron|potassium)\b.{0,40}\d/i.test(t)) n += 1;
  }
  return n;
}

function classify(ocrText, opts = {}) {
  const text = String(ocrText || '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const lower = text.toLowerCase();
  const words = (lower.match(/\S+/g) || []).length;

  const scores = {
    NUTRITION_LABEL:
      2.5 * countMatches(text, NUTRIENT_FIELDS) +
      3 * countMatches(text, LABEL_STRUCTURES) +
      1.5 * Math.min(nutrientLines(lines), 8),
    INGREDIENT_LIST: /ingredients?[:]/i.test(text) ? 8 : 0,
    FOOD_PACKAGING: 3 * countMatches(text, FOOD_PACKAGING) + (countMatches(text, NUTRIENT_FIELDS) >= 3 ? 4 : 0),
    RESTAURANT_MENU:
      4 * countMatches(text, MENU_SECTIONS) +
      2.5 * Math.min(priceShapedLines(lines), 8) +
      (opts.hint === 'menu' ? 6 : 0),
    UNSUPPORTED: 0,
  };

  const hasAnyFoodSignal = scores.NUTRITION_LABEL >= 6 || scores.INGREDIENT_LIST >= 8 ||
    scores.RESTAURANT_MENU >= 7 || scores.FOOD_PACKAGING >= 6;
  scores.UNSUPPORTED = hasAnyFoodSignal ? 0 : 4 * countMatches(text, VEHICLE_PATTERNS) + (words > 150 ? 2 : 0);

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (!total) return { type: 'UNCERTAIN', confidence: 0, scores: { ...scores } };

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, top] = ranked[0];
  const confidence = top / total;

  if (type === 'UNSUPPORTED') return { type, confidence, scores: { ...scores } };

  const margin = ranked.length > 1 ? top - ranked[1][1] : top;
  const linesForMenu = ranked[0][0] === 'RESTAURANT_MENU';
  const strongEnough =
    (type === 'NUTRITION_LABEL' && top >= 8) ||
    (type === 'INGREDIENT_LIST') ||
    (type === 'RESTAURANT_MENU' && top >= 7) ||
    (type === 'FOOD_PACKAGING' && top >= 7);
  const decisive = confidence >= 0.55 && margin >= 3 && strongEnough;
  if (decisive) return { type, confidence, scores: { ...scores } };

  return { type: 'UNCERTAIN', confidence, guess: linesForMenu ? 'RESTAURANT_MENU' : type, scores: { ...scores } };
}

module.exports = { classify };
