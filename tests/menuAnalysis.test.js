const { analyzeMenu, flagItem, goalNote } = require('../src/services/menuAnalysis');

const nullPrisma = { recipe: { findFirst: jest.fn().mockResolvedValue(null) }, ingredient: { findFirst: jest.fn().mockResolvedValue(null) } };
const ocr = `Mario's Kitchen\nMains\nGrilled Salmon $24.50 620 cal\nButter Chicken $18.00\nCaesar Salad Romaine, parmesan, croutons $12.00`;

describe('analyzeMenu', () => {
  it('extracts structured items from OCR text', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr] });
    expect(r.items.length).toBeGreaterThanOrEqual(3);
    expect(r.version).toMatch(/^menu-analysis/);
    expect(r.restaurant).toBeTruthy();
  });
  it('restaurant-reported calories get high confidence, no estimate', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr] });
    const salmon = r.items.find(i => /salmon/i.test(i.name));
    expect(salmon.nutritionSource).toBe('restaurant-reported');
    expect(salmon.confidence).toBe('high');
    expect(salmon.calories).toBe(620);
  });
  it('catalog match produces estimated range, never exact', async () => {
    const prisma = { recipe: { findFirst: jest.fn().mockResolvedValue({ recipeName: 'Butter chicken', calories: 180, proteinG: 12, carbsG: 8, fatG: 11, portionG: 100, servings: 1 }) }, ingredient: { findFirst: jest.fn() } };
    const r = await analyzeMenu({ prisma, userId: 'u1', ocrTexts: [ocr] });
    const butter = r.items.find(i => /butter chicken/i.test(i.name));
    expect(butter.nutritionSource).toBe('estimated');
    expect(butter.confidence).toBe('medium');
    expect(butter.estimate.calories.min).toBeLessThan(butter.estimate.calories.max);
  });
  it('unknown dish → insufficient_information, never invented', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr] });
    const salad = r.items.find(i => /caesar/i.test(i.name));
    expect(salad.nutritionSource).toBe('insufficient_information');
    expect(salad.estimate).toBeNull();
  });
  it('flags allergen mentions as verify-only, never safe', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr], preferences: { allergies: ['dairy'] } });
    const salad = r.items.find(i => /caesar/i.test(i.name)); // parmesan → dairy
    expect(salad.flags.some(f => f.key === 'dairy' && f.level === 'verify')).toBe(true);
    const salmon = r.items.find(i => /salmon/i.test(i.name));
    expect(salmon.flags.filter(f => f.key === 'dairy')).toHaveLength(0); // no flag ≠ allergen-free claim
  });
  it('restriction flags: vegetarian sees meat/fish items', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr], preferences: { restrictions: ['vegetarian'] } });
    expect(r.items.find(i => /salmon/i.test(i.name)).flags.some(f => f.key === 'vegetarian')).toBe(true);
    expect(r.items.find(i => /caesar/i.test(i.name)).flags.some(f => f.key === 'vegetarian')).toBe(false);
  });
  it('goal notes differ by goal', async () => {
    const base = { prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr] };
    const loss = await analyzeMenu({ ...base, preferences: { goal: 'weight_loss' } });
    const gain = await analyzeMenu({ ...base, preferences: { goal: 'muscle_gain' } });
    const s1 = loss.items.find(i => /salmon/i.test(i.name)).why;
    const s2 = gain.items.find(i => /salmon/i.test(i.name)).why;
    expect(s1).not.toBe(s2);
  });
  it('422 when nothing extractable', async () => {
    await expect(analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [''] }))
      .rejects.toMatchObject({ status: 422 });
  });
  it('includes uncertainty disclaimer', async () => {
    const r = await analyzeMenu({ prisma: nullPrisma, userId: 'u1', ocrTexts: [ocr] });
    expect(r.disclaimer).toMatch(/never means allergen-free/);
  });
});

describe('flagItem / goalNote units', () => {
  it('flags only listed allergens', () => {
    const f = flagItem({ name: 'Pad Thai', description: 'peanut sauce' }, { allergies: ['nuts'] });
    expect(f[0].key).toBe('nuts');
  });
  it('goalNote falls back gracefully with no nutrition', () => {
    expect(goalNote({ estimate: null }, 'weight_loss')).toMatch(/not available/);
  });
});

test.each([{ ocrTexts: 'not-an-array' }, { ocrTexts: ['x'.repeat(20001)] }, { images: Array(7).fill('x') }, { preferences: { allergies: 'dairy' } }])('rejects malformed/unbounded menu input: %p', async input => {
  await expect(analyzeMenu({ prisma: nullPrisma, userId: 'u1', ...input })).rejects.toMatchObject({ status: 400 });
});
