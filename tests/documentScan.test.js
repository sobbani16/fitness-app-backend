const { classify } = require('../src/services/documentClassifier');
const { parseMenuText } = require('../src/services/menuParser');
const { enrichMenuItems, portionRangeFor } = require('../src/services/menuNutrition');
const { mergeLabelPanels } = require('../src/services/labelMerge');
jest.mock('../src/services/labelScannerService', () => {
  const actual = jest.requireActual('../src/services/labelScannerService');
  return { ...actual, extractNutritionFromText: jest.fn(actual.extractWithRegex) };
});

const US_LABEL = `Nutrition Facts
Serving size 1 cup (240ml)
Servings per container 8
Amount per serving
Calories 180
Total Fat 8g
Saturated Fat 4g
Trans Fat 0g
Cholesterol 15mg
Sodium 210mg
Total Carbohydrate 22g
Dietary Fiber 1g
Total Sugars 14g
Includes 12g Added Sugars
Protein 8g
Vitamin D 2mcg
Calcium 300mg
Iron 0mg
Potassium 380mg`;

const IN_LABEL = `Nutritional Information per 100 g
Energy 462 kcal
Protein 8.2 g
Carbohydrate 68 g
Total Sugars 24 g
Added Sugars 20 g
Fat 18 g
Saturated Fat 7 g
Trans Fat 0.1 g
Sodium 190 mg
Net Qty: 75 g
FSSAI Lic. No. 10019022001234`;

const INGREDIENTS_ONLY = `Ingredients: Wheat flour, sugar, palm oil, cocoa solids 4%, leavening agents (E500, E503), salt, emulsifier (soy lecithin), artificial vanilla flavour.`;

const EVISA = `ELECTRONIC VISA
Application ID: EA88219904
Passport No: X5557771
Date of Issue: 12 MAR 2024
Expiry Date: 11 MAR 2025
Embassy of India — this e-Visa must be presented at immigration on arrival.
Nationality: United States of America`;

const MENU = `Spice Garden Restaurant
Starters
Paneer Tikka — charred cottage cheese, mint chutney — ₹280
Samosa (2 pc) ₹99
Mains
Butter Chicken ₹340
Palak Paneer ₹300 — 420 kcal
Dal Tadka ₹240
Biryani
Chicken Biryani ₹360`;

test('classifies a US Nutrition Facts panel', () => {
  const r = classify(US_LABEL);
  expect(r.type).toBe('NUTRITION_LABEL');
  expect(r.confidence).toBeGreaterThan(0.5);
});

test('classifies an Indian per-100g nutrition panel', () => {
  const r = classify(IN_LABEL);
  expect(['NUTRITION_LABEL', 'FOOD_PACKAGING']).toContain(r.type);
});

test('classifies ingredients-only text', () => {
  expect(classify(INGREDIENTS_ONLY).type).toBe('INGREDIENT_LIST');
});

test('rejects an e-Visa as UNSUPPORTED', () => {
  const r = classify(EVISA);
  expect(r.type).toBe('UNSUPPORTED');
});

test('returns UNCERTAIN on ambiguous short text', () => {
  const r = classify('hello world, nothing much here');
  expect(r.type === 'UNCERTAIN' || r.type === 'UNSUPPORTED').toBe(true);
});

test('classifies a restaurant menu', () => {
  expect(classify(MENU, { hint: 'menu' }).type).toBe('RESTAURANT_MENU');
});

test('menu parser keeps prices and calories separate', () => {
  const { items } = parseMenuText(MENU);
  const paneer = items.find(i => /paneer tikka/i.test(i.name));
  const palak = items.find(i => /palak/i.test(i.name));
  expect(paneer.price).toBe(280);
  expect(paneer.currency).toBe('INR');
  expect(paneer.calories).toBeNull();
  expect(palak.calories).toBe(420);
  expect(palak.calorieSource).toBe('restaurant-reported');
  expect(items.every(i => i.price !== i.calories || i.calories == null)).toBe(true);
});

test('menu parser tracks sections', () => {
  const { items } = parseMenuText(MENU);
  expect(items.find(i => /butter chicken/i.test(i.name)).section).toMatch(/mains/i);
  expect(items.find(i => /biryani/i.test(i.name)).section).toMatch(/biryani/i);
});

test('menu parser handles multiple pages and dedupes', () => {
  const p1 = parseMenuText('Mains\nButter Chicken ₹340').items;
  const p2 = parseMenuText('Desserts\nGulab Jamun ₹120').items;
  const names = [...p1, ...p2].map(i => i.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

test('reported calories win; no estimate is attached', async () => {
  const prisma = { recipe: { findFirst: jest.fn() }, ingredient: { findFirst: jest.fn() } };
  const [item] = await enrichMenuItems(prisma, [{ name: 'Palak Paneer', calories: 420, section: 'Mains' }]);
  expect(item.nutritionSource).toBe('restaurant-reported');
  expect(item.estimate).toBeNull();
});

test('catalog match produces a ranged estimate with provenance', async () => {
  const prisma = {
    recipe: { findFirst: jest.fn().mockResolvedValue({ recipeName: 'Butter chicken', calories: 180, proteinG: 12, carbsG: 8, fatG: 11, fiberG: 1, portionG: 100, servings: 1 }) },
    ingredient: { findFirst: jest.fn() },
  };
  const [item] = await enrichMenuItems(prisma, [{ name: 'Butter Chicken', calories: null, section: 'Mains' }]);
  expect(item.nutritionSource).toBe('estimated');
  expect(item.estimate.calories.min).toBeLessThan(item.estimate.calories.max);
  expect(item.matchedTo.kind).toBe('recipe');
  expect(item.explanation).toMatch(/estimated|serving/i);
});

test('no catalog match → insufficient_information, never invented values', async () => {
  const prisma = { recipe: { findFirst: jest.fn().mockResolvedValue(null) }, ingredient: { findFirst: jest.fn().mockResolvedValue(null) } };
  const [item] = await enrichMenuItems(prisma, [{ name: 'Chef Mystery Special', calories: null }]);
  expect(item.nutritionSource).toBe('insufficient_information');
  expect(item.estimate).toBeNull();
});

test('portion ranges differ by dish type', () => {
  expect(portionRangeFor({ name: 'Garlic Naan' })[0]).toBeLessThan(portionRangeFor({ name: 'Chicken Biryani' })[0]);
});

const INGREDIENT_PANEL = `Ingredients: Wheat flour, sugar, palm oil, cocoa solids, salt, soy lecithin.
Contains: wheat, soy. May contain traces of milk and nuts.`;
const FRONT_PANEL = `Choco Crunch Biscuits
Manufactured by GoodDay Foods Pvt Ltd
High in energy! Baked not fried.
GTIN: 8901234567890`;

test('multi-image merge combines nutrients, ingredients, allergens, brand, barcode with provenance', async () => {
  const r = await mergeLabelPanels({ nutrition: US_LABEL, ingredients: INGREDIENT_PANEL, front: FRONT_PANEL });
  expect(r.merged.calories).toBe(180);
  expect(r.merged.ingredients).toMatch(/wheat flour/i);
  expect(r.merged.allergens).toMatch(/contains/i);
  expect(r.merged.brand).toMatch(/GoodDay/i);
  expect(r.merged.barcode).toBe('8901234567890');
  expect(r.provenance.calories[0].source).toBe('nutrition');
  expect(r.provenance.ingredients[0].source).toBe('ingredients');
  expect(r.panelCount).toBe(3);
});

test('conflicting nutrition values are surfaced, not silently overwritten', async () => {
  const other = US_LABEL.replace('Sodium 210mg', 'Sodium 260mg');
  const r = await mergeLabelPanels({ nutrition: US_LABEL, ingredients: INGREDIENT_PANEL + '\n' + other });
  const c = r.conflicts.find(x => x.field === 'sodiumMg');
  expect(c).toBeTruthy();
  expect([c.kept.value, c.rejected.value].sort()).toEqual([210, 260]);
  expect(r.provenance.sodiumMg.length).toBe(2);
});

test('images from different products flag productConflict', async () => {
  const r = await mergeLabelPanels({ nutrition: US_LABEL, front: 'Totally Different Snack Bar\nGTIN: 8909999999999' });
  expect(r.productConflict).toBe(true);
});

test('missing nutrient fields stay missing, never zero', async () => {
  const r = await mergeLabelPanels({ nutrition: 'Nutrition Facts\nCalories 200\nServing size 30g' });
  expect(r.merged.sodiumMg).toBeUndefined();
  expect(r.merged.fiberG).toBeUndefined();
});

test('bare-number prices parse; mid-range numbers flagged ambiguous', () => {
  const items = parseMenuText('Mains\nPaneer Tikka 280\nSamosa 25\nChef Platter 1299').items;
  expect(items[0].price).toBe(280); expect(items[0].priceAmbiguous).toBe(true); expect(items[0].currency).toBeNull();
  expect(items[1].price).toBe(25); expect(items[1].priceAmbiguous).toBe(false);
  expect(items[2].price).toBe(1299); expect(items[2].priceAmbiguous).toBe(false);
});

test('comma and decimal bare prices parse', () => {
  const items = parseMenuText('Mains\nFamily Thali 1,299\nFilter Coffee 12.99').items;
  expect(items[0].price).toBe(1299);
  expect(items[1].price).toBe(12.99);
});

test('kcal lines are never treated as prices', () => {
  const items = parseMenuText('Mains\nGrilled Chicken 320 kcal').items;
  expect(items[0].calories).toBe(320);
  expect(items[0].price).toBeNull();
});

test('US menu format: $ prices not flagged ambiguous', () => {
  const items = parseMenuText('Entrees\nCaesar Salad $12.99\nBurger $15.50').items;
  expect(items[0].price).toBe(12.99);
  expect(items[0].currency).toBe('USD');
  expect(items[0].priceAmbiguous).toBe(false);
});

test('multiple images of the same panel keep per-image provenance', async () => {
  const second = 'Nutrition Facts\nServing size 1 cup (240ml)\nCalories 180\nSodium 210mg\nTotal Sugars 14g\nAdded Sugars 12g';
  const r = await mergeLabelPanels({ nutrition: [US_LABEL, second] });
  expect(r.merged.calories).toBe(180);
  expect(r.provenance.calories.map(e => e.source)).toEqual(['nutrition#1', 'nutrition#2']);
  expect(r.panelCount).toBe(2);
});

test('two nutrition photos with different values produce a conflict needing review', async () => {
  const second = US_LABEL.replace('Calories 180', 'Calories 195');
  const r = await mergeLabelPanels({ nutrition: [US_LABEL, second] });
  const c = r.conflicts.find(x => x.field === 'calories');
  expect(c).toBeTruthy();
  expect(r.provenance.calories).toHaveLength(2);
});

test('same product across two photos does not flag productConflict', async () => {
  const r = await mergeLabelPanels({ nutrition: [US_LABEL, 'Serving size 1 cup (240ml)\nContains: milk.'] });
  expect(r.productConflict).toBe(false);
});
