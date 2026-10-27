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

it('preserves missing nutrients, zero values, serving metadata and converts kJ only when kcal absent', () => {
 const item=usda.mapFood({fdcId:1,description:'Example',dataType:'Branded',servingSize:30,servingSizeUnit:'g',foodNutrients:[{nutrientName:'Energy',unitName:'KJ',value:418.4},{nutrientName:'Total lipid (fat)',value:0}]});
 expect(item.caloriesPer100g).toBeCloseTo(100);expect(item.fatPer100g).toBe(0);expect(item.proteinPer100g).toBeNull();expect(item.fiberPer100g).toBeNull();expect(item.sourceMetadata).toMatchObject({fdcId:'1',dataType:'Branded',servingSize:30,servingSizeUnit:'g'});
});
it('does not turn an incomplete upstream profile into zero macros', async () => {
 usda.setFetch(async()=>({ok:true,json:async()=>({foods:[{fdcId:1,foodNutrients:[{nutrientName:'Energy',unitName:'KCAL',value:100}]}]})}));
 expect(await usda.searchUsda('incomplete')).toEqual([]);
});
