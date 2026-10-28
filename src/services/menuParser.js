// Parses restaurant menu OCR text into structured items.
// Keeps prices and calories strictly separated — a ₹199 is never a calorie.

const CURRENCY = /(?:rs\.?|inr|usd|\$|₹|€|£)/i;
const PRICE = new RegExp(`(?:${CURRENCY.source})\\s?(\\d+(?:\\.\\d{1,2})?)|\\b(\\d+(?:\\.\\d{1,2})?)\\s?(?:${CURRENCY.source})`, 'i');
// Calories: "320 kcal", "cal: 450", "(180 cal)", "Kcal 220". Never bare numbers.
const KCAL = /(\d{2,4})\s*(?:k?cals?|calories|kilo\s*joules?|kj)\b|(?:k?cals?|calories)\s*[:\-]?\s*(\d{2,4})/i;
const SECTION_WORDS = /^(appetizers?|starters?|entrees?|mains?|main course|desserts?|beverages?|drinks?|cocktails?|mocktails?|breakfast|brunch|lunch|dinner|specials?|sides?|soups?|salads?|wraps?|pizza|pasta|grill|veg(etarian)?|non.?veg(etarian)?|biryani|curries|tandoori|dosa|breads?|rice|combos?|thali)\b/i;
const PRICE_ONLY = /^(?:rs\.?|inr|usd|\$|₹|€|£)?\s?\d+(?:\.\d{1,2})?\s?(?:rs\.?|inr|₹)?$/i;
// Trailing bare number: "Paneer Tikka 280", "Samosa ..... 12.99", "Thali 1,299".
// Only counts when a dish name precedes it; ambiguity is flagged, never guessed.
const BARE_PRICE = /^(.*?)[\s\-–—•·|.]*?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*$/;

function currencyOf(s) {
  if (!s) return null;
  if (/rs\.?|inr|₹/i.test(s)) return 'INR';
  if (/\$|usd/i.test(s)) return 'USD';
  if (/€/.test(s)) return 'EUR';
  if (/£/.test(s)) return 'GBP';
  return null;
}

// Two-line item: name(+price) line optionally followed by a description line.
function parseMenuText(ocrText, opts = {}) {
  const lines = String(ocrText || '').split(/\r?\n/).map(l => l.trim());
  const items = [];
  let section = opts.restaurantName ? null : null;
  let currentSection = opts.sectionHint || null;
  let restaurant = opts.restaurantName || null;
  let pending = null;

  const flush = () => { if (pending) items.push(pending); pending = null; };
  for (const raw of lines) {
    if (!raw) { flush(); continue; }
    const kcal = KCAL.exec(raw);
    const priceMatch = PRICE.exec(raw);

    if (SECTION_WORDS.test(raw) && !priceMatch && raw.length <= 40 && !kcal) {
      flush();
      currentSection = raw.replace(/\s{2,}.*/, '').trim();
      continue;
    }
    if (!restaurant && /^(restaurant|café|cafe|hotel|eatery|kitchen|dhaba)\b.{0,40}$/i.test(raw)) {
      restaurant = raw;
      continue;
    }

    const bare = !priceMatch && !kcal ? BARE_PRICE.exec(raw) : null;
    const bareName = bare ? bare[1].replace(/[\s\-–—•·|]+$/, '').trim() : '';
    if (priceMatch || (bare && bareName.length >= 3 && /[a-z]/i.test(bareName))) {
      const matched = priceMatch ? priceMatch[0] : bare[2];
      const at = priceMatch ? raw.indexOf(priceMatch[0]) : raw.lastIndexOf(bare[2]);
      const namePart = (priceMatch ? raw.slice(0, at) : bareName).replace(/[\s\-–—•·\.\|]+$/, '').trim();
      const descPart = priceMatch ? raw.slice(at + priceMatch[0].length).trim() : null;
      const priceVal = Number((priceMatch ? (priceMatch[1] ?? priceMatch[2]) : bare[2]).replace(/,/g, ''));
      if (!namePart || namePart.length < 2) { if (pending) pending.price = Number.isFinite(priceVal) ? priceVal : null; continue; }
      flush();
      // Bare numbers in the plausible-calorie band could be either price or
      // kcal — flag for user confirmation instead of guessing.
      const ambiguous = !priceMatch && priceVal >= 50 && priceVal <= 900;
      pending = {
        name: namePart,
        description: descPart || null,
        price: Number.isFinite(priceVal) ? priceVal : null,
        currency: priceMatch ? currencyOf(priceMatch[0]) : null,
        priceAmbiguous: ambiguous,
        calories: kcal ? Number(kcal[1] ?? kcal[2]) : null,
        calorieSource: kcal ? 'restaurant-reported' : null,
        section: currentSection,
      };
      continue;
    }
    if (kcal && pending) {
      pending.calories = Number(kcal[1] ?? kcal[2]);
      pending.calorieSource = 'restaurant-reported';
      continue;
    }
    if (PRICE_ONLY.test(raw)) continue;
    if (!pending) {
      if (raw.length < 2 || raw.length > 60) continue;
      pending = { name: raw, description: null, price: null, currency: null, calories: kcal ? Number(kcal[1] ?? kcal[2]) : null, calorieSource: kcal ? 'restaurant-reported' : null, section: currentSection };
      continue;
    }
    if (!pending.description && raw.length <= 160 && !MENU_PRICE_TEST(raw)) {
      pending.description = raw;
      continue;
    }
    flush();
    if (raw.length >= 2 && raw.length <= 60) pending = { name: raw, description: null, price: null, currency: null, calories: null, calorieSource: null, section: currentSection };
  }
  flush();
  return { restaurant, items: items.filter(i => i.name && i.name.length >= 2) };
}
function MENU_PRICE_TEST(s) { return PRICE.test(s); }

module.exports = { parseMenuText };
