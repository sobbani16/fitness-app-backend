const usda = require('../src/services/usdaService');

afterEach(() => usda.setFetch(globalThis.fetch));

describe('searchUsda', () => {
  it('returns [] for an empty query', async () => {
    const r = await usda.searchUsda('');
    expect(r).toEqual([]);
  });

  it('maps USDA foods to per-100g records (prefers kcal energy)', async () => {
    usda.setFetch(async () => ({
      ok: true,
      json: async () => ({
        foods: [
          {
            fdcId: 171077,
            description: 'Chicken breast, raw',
            foodNutrients: [
              { nutrientName: 'Energy', unitName: 'kJ', value: 690 },
              { nutrientName: 'Energy', unitName: 'KCAL', value: 165 },
              { nutrientName: 'Protein', value: 31 },
              { nutrientName: 'Carbohydrate, by difference', value: 0 },
              { nutrientName: 'Total lipid (fat)', value: 3.6 },
            ],
          },
        ],
      }),
    }));
    const r = await usda.searchUsda('chicken');
    expect(r[0]).toMatchObject({
      fdcId: '171077',
      name: 'Chicken breast, raw',
      caloriesPer100g: 165,
      proteinPer100g: 31,
      fatPer100g: 3.6,
      source: 'usda',
    });
  });

  it('reports unavailability on rate limit (429)', async () => {
    usda.setFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(usda.searchUsda('chicken')).rejects.toMatchObject({status:503});
  });

  it('reports unavailability on network failure', async () => {
    usda.setFetch(async () => {
      throw new Error('network');
    });
    await expect(usda.searchUsda('chicken')).rejects.toMatchObject({status:503});
  });

  it('reports unavailability on unexpected non-ok status (e.g. 500)', async () => {
    usda.setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(usda.searchUsda('chicken')).rejects.toMatchObject({status:503});
  });
});
