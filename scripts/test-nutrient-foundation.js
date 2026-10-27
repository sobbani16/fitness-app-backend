// Synthetic fixtures only, restricted to a disposable local database.
const assert = require('node:assert/strict');
const {randomUUID,createHash} = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if(url.hostname!=='127.0.0.1' || !url.pathname.startsWith('/fitness_nutrient_')) throw new Error('Use a local disposable fitness_nutrient_ database');
const {getPrisma} = require('../src/lib/prisma');
const {seedNutrients} = require('../src/services/nutrientMaster');
const {importNutrients} = require('../src/services/nutrientImport');
const p=getPrisma();
const digest = rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
(async()=>{
  const baseline = digest(await p.ingredient.findMany({orderBy:{id:'asc'}}));
  await seedNutrients(p);
  const master = await p.nutrient.findMany({orderBy:{code:'asc'}});
  await seedNutrients(p);
  assert.deepEqual(await p.nutrient.findMany({orderBy:{code:'asc'}}),master);
  assert.equal(master.length,27);
  const nonce=randomUUID(), name=`synthetic fixture ${nonce}`, ids=[];
  try {
    for(let i=0;i<2;i++) ids.push((await p.ingredient.create({data:{name,normalizedName:name,source:'test-only',caloriesPer100g:1,proteinPer100g:1,carbsPer100g:1,fatPer100g:1}})).id);
    const base={ingredientId:ids[0],source:'IFCT',sourceFoodId:'synthetic',sourceDataset:'test-fixture',sourceCitation:'Synthetic test data; not nutritional advice',basis:'PER_100_G',preparationType:'RAW',verifiedAt:'2020-01-01T00:00:00Z',nutrients:[{code:'PROTEIN',amountPer100g:'1250',unit:'mg'},{code:'POTASSIUM',amountPer100g:null,unit:'mg'}]};
    const ambiguous=await importNutrients(p,[{...base,ingredientId:undefined,name}],{apply:true});
    assert.equal(ambiguous.records[0].reason,'AMBIGUOUS_INGREDIENT');
    assert.equal(await p.ingredientNutritionProfile.count(),0);
    await importNutrients(p,[base]);
    assert.equal(await p.ingredientNutritionProfile.count(),0);
    const batch=[base,{...base,preparationType:'BOILED',nutrients:[{code:'PROTEIN',amountPer100g:'0.5',unit:'g'}]}];
    await Promise.all([importNutrients(p,batch,{apply:true}),importNutrients(p,batch,{apply:true})]);
    const profiles=await p.ingredientNutritionProfile.findMany({where:{ingredientId:ids[0]},include:{nutrients:{include:{nutrient:true}}},orderBy:{preparationType:'asc'}});
    assert.equal(profiles.length,2);
    const raw=profiles.find(x=>x.preparationType==='RAW');
    assert.equal(raw.nutrients.find(x=>x.nutrient.code==='PROTEIN').amountPer100g.toString(),'1.25');
    assert.equal(raw.nutrients.find(x=>x.nutrient.code==='POTASSIUM').amountPer100g,null);
    const before=digest(profiles);
    await importNutrients(p,batch,{apply:true});
    assert.equal(digest(await p.ingredientNutritionProfile.findMany({where:{ingredientId:ids[0]},include:{nutrients:{include:{nutrient:true}}},orderBy:{preparationType:'asc'}})),before);
    const unverified=await importNutrients(p,[{...base,verifiedAt:null,nutrients:[{code:'PROTEIN',amountPer100g:'9',unit:'g'}]}],{apply:true});
    assert.equal(unverified.records[0].status,'PROTECTED');
    const conflict=await importNutrients(p,[{...base,nutrients:[{code:'PROTEIN',amountPer100g:'9',unit:'g'}]}],{apply:true});
    assert.equal(conflict.records[0].reason,'VERIFIED_VALUE_CONFLICT');
    const newerConflict=await importNutrients(p,[{...base,verifiedAt:'2022-01-01T00:00:00Z',nutrients:[{code:'PROTEIN',amountPer100g:'9',unit:'g'}]}],{apply:true,preserveVerified:true});
    assert.equal(newerConflict.records[0].reason,'VERIFIED_VALUE_CONFLICT');
    await importNutrients(p,[{...base,verifiedAt:'2021-01-01T00:00:00Z',nutrients:[{code:'POTASSIUM',amountPer100g:'2',unit:'mg'}]}],{apply:true});
    const partial={...base,ingredientId:ids[1],verifiedAt:null};
    await importNutrients(p,[partial],{apply:true});
    const incomplete=await importNutrients(p,[{...partial,verifiedAt:base.verifiedAt,nutrients:[{code:'POTASSIUM',amountPer100g:'2',unit:'mg'}]}],{apply:true});
    assert.equal(incomplete.records[0].reason,'INCOMPLETE_VERIFICATION');
    const protein=master.find(n=>n.code==='PROTEIN');
    await assert.rejects(()=>p.ingredientNutrient.create({data:{nutritionProfileId:raw.id,nutrientId:protein.id,amountPer100g:2}}));
    await assert.rejects(()=>p.ingredientNutrient.updateMany({where:{nutritionProfileId:raw.id},data:{amountPer100g:-1}}));
    await assert.rejects(()=>p.ingredientNutrient.create({data:{nutritionProfileId:randomUUID(),nutrientId:protein.id,amountPer100g:1}}));
    console.log('PASS seed/import idempotency, concurrent retries, raw/cooked separation, unit conversion, NULL, ambiguous matches, verification protection, unique/FK/check constraints');
  } finally {
    await p.ingredientNutritionProfile.deleteMany({where:{ingredientId:{in:ids}}});
    await p.ingredient.deleteMany({where:{id:{in:ids}}});
  }
  assert.equal(digest(await p.ingredient.findMany({orderBy:{id:'asc'}})),baseline);
  console.log('PASS all preexisting ingredient IDs and nutritional records unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>p.$disconnect());
