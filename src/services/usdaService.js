// USDA FoodData Central (FDC) ingredient search, proxied so the API key stays
// server-side. Falls back to a deterministic mock (derived from the local food
// DB) when no usable API key is available or USDA is unreachable/rate-limited,
// so dev works without a key.
//
// Docs: https://fdc.nal.usda.gov/api-guide.html
// Endpoint used: POST /foods/search

const { FOOD_DB } = require('./foodDetector');

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

// Injectable for tests (mirrors weatherService / recipeService pattern).
let _fetch = globalThis.fetch;
function setFetch(fn) {
  _fetch = fn;
}

// DEMO_KEY works out of the box for light exploration (heavily rate-limited).
// Set USDA_API_KEY in .env for real usage.
function getApiKey() {
  return process.env.USDA_API_KEY || 'DEMO_KEY';
}

function usingDemoKey() {
  return !process.env.USDA_API_KEY;
}

function round(n) {
  return Math.round(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---- Mock fallback (no usable key / USDA down) ---------------------------

function mockSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const matches = FOOD_DB.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.keywords.some((k) => k.includes(q) || q.includes(k)),
  );
  const list = (matches.length ? matches : FOOD_DB).slice(0, 8);
  return list.map((f) => ({
    fdcId: `mock-${FOOD_DB.indexOf(f)}`,
    name: f.name,
    caloriesPer100g: f.kcalPer100g,
    proteinPer100g: f.p100,
    carbsPer100g: f.c100,
    fatPer100g: f.f100,
    source: 'mock (no USDA_API_KEY set)',
  }));
}

// ---- USDA ----------------------------------------------------------------

// USDA search results carry a `foodNutrients` array of
// { nutrientName, value, unitName }. Pull a value by matching nutrient name(s).
function nutrientValue(foodNutrients, names) {
  const wanted = names.map((n) => n.toLowerCase());
  const n = (foodNutrients || []).find((x) =>
    wanted.includes((x.nutrientName || '').toLowerCase()),
  );
  return n ? Number(n.value) || 0 : 0;
}

// Energy can be reported in both kcal and kJ; prefer the kcal entry.
function energyKcal(foodNutrients) {
  const energies = (foodNutrients || []).filter(
    (x) => (x.nutrientName || '').toLowerCase() === 'energy',
  );
  const kcal = energies.find(
    (x) => (x.unitName || '').toUpperCase() === 'KCAL',
  );
  const chosen = kcal || energies[0];
  return chosen ? Number(chosen.value) || 0 : 0;
}

function mapFood(f) {
  return {
    fdcId: String(f.fdcId),
    name: f.description || 'Food',
    caloriesPer100g: round(energyKcal(f.foodNutrients)),
    proteinPer100g: round1(nutrientValue(f.foodNutrients, ['Protein'])),
    carbsPer100g: round1(
      nutrientValue(f.foodNutrients, ['Carbohydrate, by difference']),
    ),
    fatPer100g: round1(nutrientValue(f.foodNutrients, ['Total lipid (fat)'])),
    source: 'usda',
  };
}

/**
 * Search USDA for ingredients matching `query`.
 * Returns an array of per-100g ingredient records. Degrades to a mock list on
 * missing/invalid key, rate limiting, or network failure.
 * @param {string} query
 * @param {number} [number=8]
 */
async function searchUsda(query, number = 8) {
  const q = (query || '').trim();
  if (!q) return [];

  const url = `${USDA_BASE}/foods/search?api_key=${encodeURIComponent(getApiKey())}`;
  let res;
  try {
    res = await _fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        pageSize: number,
        dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
      }),
    });
  } catch (err) {
    // Network failure → degrade gracefully.
    return mockSearch(q);
  }

  if (!res.ok) {
    // Auth / rate-limit issues (common with DEMO_KEY) → fall back to mock.
    if ([401, 403, 429].includes(res.status)) return mockSearch(q);
    throw new Error(`usda search failed: ${res.status}`);
  }

  const data = await res.json();
  const foods = Array.isArray(data && data.foods) ? data.foods : [];
  const mapped = foods.map(mapFood).filter((m) => m.caloriesPer100g > 0);
  // If USDA returned nothing useful, still give the user something.
  return mapped.length ? mapped : mockSearch(q);
}

module.exports = {
  searchUsda,
  setFetch,
  getApiKey,
  usingDemoKey,
};
