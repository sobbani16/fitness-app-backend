const {normalizeAmount,prepareRecord,identityKey,matchIngredient} = require('../src/services/nutrientImport');
const {NUTRIENTS} = require('../src/services/nutrientMaster');
const row = {ingredientId:'existing',source:'USDA',sourceFoodId:'fixture-1',sourceDataset:'test edition',sourceCitation:'Synthetic test fixture only',preparationType:'RAW',basis:'PER_100_G',nutrients:[{code:'PROTEIN',amountPer100g:'1.25',unit:'g'}]};
test('master definitions are unique and contain all 27 requested nutrients without quantities',()=>{
  expect(NUTRIENTS).toHaveLength(27);
  expect(new Set(NUTRIENTS.map(n=>n.code)).size).toBe(27);
  expect(new Set(NUTRIENTS.map(n=>n.name)).size).toBe(27);
  expect(NUTRIENTS.every(n=>!('amountPer100g' in n))).toBe(true);
});
test.each([['1.25','g','mg','1250.000000000'],['250','µg','mg','0.250000000'],['4.184','kJ','kcal','1.000000000'],[null,'g','g',null],['0','g','g','0.000000000']])('normalizes %s %s -> %s', (value,from,to,expected)=>expect(normalizeAmount(value,from,to)).toBe(expected));
test.each([['-1','g'],['NaN','g'],['Infinity','g'],['','g'],['1','IU'],['1','ml'],['1000000000','g'],['0.00000000001','g']])('rejects unsupported value/unit %s %s',(value,from)=>expect(()=>normalizeAmount(value,from,'g')).toThrow());
test('raw/cooked, methods, source IDs and dataset editions have separate identities',()=>{
  const record=prepareRecord(row), key=identityKey('existing',record);
  for(const change of [{preparationType:'BOILED'},{preparationMethod:'soaked overnight'},{sourceFoodId:'fixture-2'},{sourceDataset:'new edition'},{source:'IFCT'}]) expect(identityKey('existing',prepareRecord({...row,...change}))).not.toBe(key);
  expect(identityKey('existing',prepareRecord({...row,verifiedAt:'2020-01-01T00:00:00Z'}))).toBe(key);
});
test('missing source food ID requires an explicit stable record key',()=>{
  expect(()=>prepareRecord({...row,sourceFoodId:null})).toThrow();
  expect(prepareRecord({...row,sourceFoodId:null,sourceRecordKey:'manual-record'}).sourceRecordKey).toBe('record:manual-record');
});
test.each([{basis:'PER_100_ML'},{preparationType:null},{nutrients:[...row.nutrients,...row.nutrients]},{nutrients:[{code:'UNKNOWN',amountPer100g:1,unit:'g'}]}])('rejects ambiguous nutrition semantics %j',change=>expect(()=>prepareRecord({...row,...change})).toThrow());
test('ambiguous exact names/aliases require review and do not pick the first ingredient',()=>{
 const ingredients=[{id:'raw',normalizedName:'chickpeas',catalog:{aliases:['chana']}},{id:'boiled',normalizedName:'chickpeas',catalog:{aliases:['chana']}}];
 expect(matchIngredient({name:'chana'},ingredients)).toMatchObject({status:'REVIEW_REQUIRED',candidates:['raw','boiled']});
 expect(matchIngredient({ingredientId:'boiled'},ingredients).ingredient.id).toBe('boiled');
 expect(matchIngredient({ingredientId:'missing',name:'chana'},ingredients).reason).toBe('UNMATCHED_INGREDIENT');
});
