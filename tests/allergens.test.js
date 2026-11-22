// HF-0001 / HF-0004 / HF-0014 — canonical allergen taxonomy, fail-closed assessment.
// Expected outcomes are auditor-authored (FDA major allergens + mustard, common
// Indian ingredient names), not derived from the implementation.
const A = require('../src/services/allergens');
const user = (...names) => A.normalizeAllergyList(names);
const item = (name, lines, extra = {}) => ({ name, lines: lines.map(l => (typeof l === 'string' ? { name: l, resolved: true } : l)), ...extra });

describe('canonicalize — plural/synonym aware (regression: HF-0014 Dairy/Peanuts/Tree nuts misses)', () => {
  test.each([
    ['Dairy', ['milk']], ['dairy allergy', ['milk']], ['Peanuts', ['peanut']], ['groundnut', ['peanut']],
    ['Tree nuts', ['tree_nuts']], ['tree-nuts', ['tree_nuts']], ['Gluten', ['wheat_gluten']], ['wheat', ['wheat_gluten']],
    ['Crustaceans', ['shellfish']], ['eggs', ['egg']], ['soya', ['soy']], ['Sesame', ['sesame']], ['mustard', ['mustard']],
    ['nut-free', ['tree_nuts', 'peanut']], ['tree_nuts', ['tree_nuts']], ['wheat gluten', ['wheat_gluten']],
  ])('%s → %j', (n, keys) => expect(A.canonicalize(n).sort()).toEqual(keys.sort()));
  test('unknown names stay custom, never dropped', () => {
    expect(A.normalizeAllergyList(['Kiwi', 'Dairy'])).toEqual({ keys: ['milk'], custom: ['kiwi'] });
  });
});

describe('assess — conflicts (each was a false negative in at least one old consumer)', () => {
  test.each([
    ['Dairy', 'Paneer butter masala', ['paneer', 'butter', 'tomato'], 'milk'],
    ['Milk', 'Mango lassi', ['mango', 'lassi'], 'milk'],
    ['Milk', 'Curd rice', ['curd', 'rice'], 'milk'],
    ['Milk', 'Dal tadka', ['toor dal', 'ghee'], 'milk'],
    ['Peanuts', 'Peanut chutney', ['peanut', 'chilli'], 'peanut'],
    ['Peanut', 'Poha', ['flattened rice', 'groundnuts'], 'peanut'],
    ['Tree nuts', 'Kaju katli', ['cashew', 'sugar'], 'tree_nuts'],
    ['Tree nuts', 'Pesto pasta', ['basil', 'pine nuts'], 'tree_nuts'],
    ['Gluten', 'Seviyan upma', ['vermicelli', 'onion'], 'wheat_gluten'],
    ['Gluten', 'Aloo paratha', ['atta', 'potato'], 'wheat_gluten'],
    ['Wheat', 'Upma', ['sooji', 'onion'], 'wheat_gluten'],
    ['Sesame', 'Til ladoo', ['til', 'jaggery'], 'sesame'],
    ['Shellfish', 'Prawn curry', ['prawns', 'coconut'], 'shellfish'],
    ['Fish', 'Fish curry', ['rohu', 'onion'], 'fish'],
    ['Egg', 'Egg bhurji', ['eggs', 'onion'], 'egg'],
    ['Soy', 'Tofu stir fry', ['tofu', 'pepper'], 'soy'],
    ['Mustard', 'Sarson ka saag', ['mustard greens', 'spinach'], 'mustard'],
  ])('%s vs %s', (allergy, dish, lines, key) => {
    const r = A.assess(item(dish, lines), user(allergy));
    expect(r.status).toBe('conflict');
    expect(r.conflicts.map(c => c.allergen)).toContain(key);
  });
  test('declared recipe allergens count even when names do not reveal them', () => {
    expect(A.assess(item('Margherita Pizza', ['dough', 'tomato']), user('soy')).status).toBe('clear');
    expect(A.assess(item('Margherita Pizza', ['dough', 'tomato'], { declared: ['gluten', 'soy'] }), user('soy')).status).toBe('conflict');
  });
  test('custom allergen matches whole words', () => {
    expect(A.assess(item('Fruit salad', ['kiwi', 'banana']), user('kiwi')).status).toBe('conflict');
  });
});

describe('assess — no false conflicts for plant "milks"/butters', () => {
  test.each([['Coconut curry', ['coconut milk', 'onion']], ['Almond milk smoothie', ['almond milk', 'banana']]])('%s is not dairy', (d, l) => {
    expect(A.assess(item(d, l), user('milk')).status).toBe('clear');
  });
});

describe('assess — FAIL CLOSED when composition is unknown', () => {
  test('unresolved ingredient line → unknown', () => {
    expect(A.assess(item('Mystery bowl', [{ name: 'house mix', resolved: false }]), user('egg')).status).toBe('unknown');
  });
  test('composite ingredient without declared allergens → unknown', () => {
    expect(A.assess(item('Noodle bowl', ['rice noodles', 'stir fry sauce']), user('peanut')).status).toBe('unknown');
  });
  test('composite with a declared allergen list is evaluable', () => {
    expect(A.assess(item('Bowl', [{ name: 'stir fry sauce', resolved: true, declared: ['soy'] }]), user('peanut')).status).toBe('clear');
  });
  test('no ingredient list → unknown', () => {
    expect(A.assess({ name: 'Chef special' }, user('milk')).status).toBe('unknown');
  });
  test('oats are a gluten cross-contact risk → unknown, not clear', () => {
    expect(A.assess(item('Porridge', ['rolled oats', 'water']), user('gluten')).status).toBe('unknown');
  });
  test('spice blend uncertainty is limited to plausibly compounded allergens', () => {
    expect(A.assess(item('Chana masala', ['chickpeas', 'garam masala']), user('milk')).status).toBe('clear');
    expect(A.assess(item('Chana masala', ['chickpeas', 'garam masala']), user('mustard')).status).toBe('unknown');
  });
  test('no allergies → not_applicable (never blocks)', () => {
    expect(A.assess(item('Anything', ['paneer']), user()).status).toBe('not_applicable');
  });
  test('ELIGIBLE admits only clear / not_applicable', () => {
    expect(['clear', 'not_applicable', 'unknown', 'conflict'].map(A.ELIGIBLE)).toEqual([true, true, false, false]);
  });
});

describe('recipeItem — USDA-assembled recipe lines resolve from provenance', () => {
  test('lines named in nutritionSource.ingredients count as resolved', () => {
    const r = { recipeName: 'Banana and yogurt', allergens: [], nutritionSource: { ingredients: [{ description: 'Bananas, raw' }, { description: 'Yogurt, Greek, plain, nonfat' }] }, ingredients: [{ ingredientName: 'Bananas, raw' }, { ingredientName: 'Yogurt, Greek, plain, nonfat' }] };
    expect(A.assess(A.recipeItem(r), user('egg')).status).toBe('clear');
    expect(A.assess(A.recipeItem(r), user('milk')).status).toBe('conflict'); // HF-0010: allergens[] empty but yogurt present
  });
});
