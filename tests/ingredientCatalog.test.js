const { validateCatalog, nutrition } = require('../src/services/ingredientCatalog');
const rows = require('../data/humai-ingredients.json');
test('catalog keeps incomplete nutrition hidden without substituting zeros', () => {
 const validated = validateCatalog(rows);
 expect(validated).toHaveLength(684);expect(validated.filter(x=>x.usable)).toHaveLength(212);
 expect(validated.find(x=>x.row.id==='IFCT-M001').usable).toBe(false);
 expect(validated.find(x=>x.row.id==='IFCT-M001').row.carbs_g_per_100g).toBeNull();
});
test('normalizes duplicate names and rejects duplicate identities before any writes', () => {
 expect(()=>validateCatalog([rows[0],{...rows[1],name:' '+rows[0].name.toUpperCase()+' '}])).toThrow('Duplicate');
 expect(()=>validateCatalog([rows[0],rows[0]])).toThrow('Duplicate');
});
test.each([-1, Infinity, '10'])('rejects malformed nutrients %p', value => {
 expect(()=>validateCatalog([{...rows[0],kcal_per_100g:value}])).toThrow('Invalid');
});
test('converts available carbohydrate explicitly and preserves source values', () => {
 const row=rows.find(x=>x.id==='IFCT-A003');expect(nutrition(row).carbsPer100g).toBe(73.27);expect(row.carbs_g_per_100g).toBe(61.78);
});
