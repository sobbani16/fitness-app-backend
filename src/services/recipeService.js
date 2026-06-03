// Recipe search + nutrition via Spoonacular, proxied so the API key stays
// server-side. Falls back to a deterministic mock (derived from the local
// food DB) when SPOONACULAR_API_KEY is not set, so dev works without a key.

const { FOOD_DB } = require('./foodDetector');

const SPOONACULAR_BASE = 'https://api.spoonacular.com';

// Injectable for tests (mirrors weatherService pattern).
let _fetch = globalThis.fetch;
function setFetch(fn) { _fetch = fn; }

function getApiKey() {
  return process.env.SPOONACULAR_API_KEY || '';
}

function hasApiKey() {
  return Boolean(getApiKey());
}

function round(n) { return Math.round(n); }

// ---- Mock fallback (no API key) -----------------------------------------

function mockSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const matches = FOOD_DB.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q) ||
      f.keywords.some((k) => k.includes(q) || q.includes(k)),
  );
  const list = (matches.length ? matches : FOOD_DB).slice(0, 8);
  return list.map((f, i) => ({
    id: `mock-${FOOD_DB.indexOf(f)}`,
    title: f.name,
    image: null,
  }));
}

function mockNutrition(id) {
  const idx = Number(String(id).replace('mock-', ''));
  const f = FOOD_DB[idx] || FOOD_DB[0];
  const grams = f.portion_g;
  const calories = round((f.kcalPer100g * grams) / 100);
  return {
    id: String(id),
    name: f.name,
    servings: 1,
    servingWeightGrams: grams,
    calories,
    caloriesPer100g: f.kcalPer100g,
    macrosPer100g: { protein_g: f.p100, carbs_g: f.c100, fat_g: f.f100 },
    source: 'mock (no SPOONACULAR_API_KEY set)',
  };
}

// ---- Spoonacular ---------------------------------------------------------

async function spoonacularSearch(query) {
  const url = `${SPOONACULAR_BASE}/recipes/autocomplete?number=8&query=${encodeURIComponent(
    query || '',
  )}&apiKey=${getApiKey()}`;
  const res = await _fetch(url);
  if (!res.ok) throw new Error(`recipe search failed: ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [];
  return arr.map((r) => ({
    id: String(r.id),
    title: r.title,
    image: r.image
      ? `https://spoonacular.com/cdn/ingredients_100x100/${r.image}`
      : null,
  }));
}

function nutrientAmount(nutrients, name) {
  const n = (nutrients || []).find(
    (x) => x.name && x.name.toLowerCase() === name.toLowerCase(),
  );
  return n ? Number(n.amount) || 0 : 0;
}

async function spoonacularNutrition(id) {
  const url = `${SPOONACULAR_BASE}/recipes/${encodeURIComponent(
    id,
  )}/information?includeNutrition=true&apiKey=${getApiKey()}`;
  const res = await _fetch(url);
  if (!res.ok) throw new Error(`recipe nutrition failed: ${res.status}`);
  const data = await res.json();

  const nutrients = data?.nutrition?.nutrients || [];
  const calories = round(nutrientAmount(nutrients, 'Calories'));
  const protein = round(nutrientAmount(nutrients, 'Protein'));
  const carbs = round(nutrientAmount(nutrients, 'Carbohydrates'));
  const fat = round(nutrientAmount(nutrients, 'Fat'));

  const wps = data?.nutrition?.weightPerServing;
  const servingWeightGrams =
    wps && Number(wps.amount) > 0 ? round(Number(wps.amount)) : 0;

  // Per-100g so the client can re-scale to any portion (e.g. BLE scale).
  const factor = servingWeightGrams > 0 ? 100 / servingWeightGrams : 0;
  const caloriesPer100g = factor ? round(calories * factor) : calories;
  const macrosPer100g = factor
    ? {
        protein_g: round(protein * factor),
        carbs_g: round(carbs * factor),
        fat_g: round(fat * factor),
      }
    : { protein_g: protein, carbs_g: carbs, fat_g: fat };

  return {
    id: String(id),
    name: data?.title || 'Recipe',
    servings: Number(data?.servings) || 1,
    servingWeightGrams: servingWeightGrams || 100,
    calories,
    caloriesPer100g,
    macrosPer100g,
    source: 'spoonacular',
  };
}

// ---- Public API ----------------------------------------------------------

async function searchRecipes(query) {
  if (!hasApiKey()) return mockSearch(query);
  try {
    return await spoonacularSearch(query);
  } catch (err) {
    // Network/key failure → degrade gracefully to mock.
    return mockSearch(query);
  }
}

async function getRecipeNutrition(id) {
  if (!id) throw new Error('id is required');
  if (!hasApiKey() || String(id).startsWith('mock-')) return mockNutrition(id);
  try {
    return await spoonacularNutrition(id);
  } catch (err) {
    return mockNutrition(id);
  }
}

module.exports = {
  searchRecipes,
  getRecipeNutrition,
  setFetch,
  hasApiKey,
};
