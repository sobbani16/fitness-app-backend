const assert=require('node:assert/strict'),fs=require('node:fs');const u=new URL(process.env.DATABASE_URL||'http://missing');if(u.hostname!=='127.0.0.1'||!u.pathname.startsWith('/fitness_catalog_v5'))throw Error('Isolated fitness_catalog_v5 database required');
const {getPrisma}=require('../src/lib/prisma'),{parseCsv,checksum}=require('../src/services/ingredientCsv'),{importV5}=require('../src/services/ingredientImportV5');const {calculate,calculateRecipe}=require('../src/services/ingredientNutrition');const {searchIngredients}=require('../src/services/ingredientService');const db=getPrisma(),text=fs.readFileSync('data/imports/humai_ingredient_catalog_v5_with_verification_labels.csv','utf8'),rows=parseCsv(text),options={apply:true,checksum:checksum(text)};
(async()=>{let user;try{
 const previous=await db.ingredient.findMany({where:{catalogId:{not:null}}});
 user=await db.user.create({data:{email:`v5-${Date.now()}@example.test`}});
 const log=await db.foodLog.create({data:{userId:user.id,foodName:'Historical meal',quantityG:100,calories:123,proteinG:4,carbsG:8,fatG:2,mealType:'lunch'}});
 const preview=await importV5(db,rows,{...options,apply:false});assert.equal(preview.input,2893);console.log('PREVIEW',JSON.stringify(preview));
 const result=await importV5(db,rows,options);console.log('APPLY',JSON.stringify(result));
 for(const old of previous){const now=await db.ingredient.findUnique({where:{catalogId:old.catalogId}});assert.equal(now.id,old.id);}
 const count=await db.ingredient.count(),ids=(await db.ingredient.findMany({orderBy:{id:'asc'}})).map(x=>x.id);
 const repeat=await importV5(db,rows,options);assert.equal(repeat.inserted,0);assert.equal(repeat.updated,0);assert.equal(await db.ingredient.count(),count);assert.deepEqual((await db.ingredient.findMany({orderBy:{id:'asc'}})).map(x=>x.id),ids);assert.equal(await db.ingredientCatalog.count(),2893);
 assert.deepEqual(await db.foodLog.findUnique({where:{id:log.id}}),log);
 require('../src/services/usdaService').setFetch(async()=>{throw Error('USDA must not run');});
 for(const query of ['bajra','atta','aata','wheat flour','toor dal','arhar dal','kandi pappu','ladyfinger','okra','bhindi','Amul milk','Jif peanut butter','whey protein','basmati rice','grilled chicken breast','Chick-fil-A Sauce']){const results=await searchIngredients({userId:user.id,query});assert.ok(results.length,query);assert.ok(results.every(x=>x.catalogId));}
 const bajra=await db.ingredient.findUnique({where:{catalogId:'IFCT-A003'}});const calc=await calculate(bajra.id,{grams:150});assert.equal(calc.nutrition.carbsG,bajra.carbsPer100g*1.5);
 const serving=await db.ingredientServing.findFirst();const calculated=await calculate(serving.ingredientId,{servingId:serving.id,count:2});assert.equal(calculated.grams,serving.grams*2);
 const recipe=await calculateRecipe([{ingredientId:bajra.id,grams:100}],200);assert.equal(recipe.per100g.proteinG,bajra.proteinPer100g/2);
 const lower={...rows[0],nutrition_verification_level:'ESTIMATED',kcal_per_100g:999};const protectedResult=await importV5(db,[lower],{...options,checksum:'test-lower'});assert.equal(protectedResult.skipped,1);assert.equal(protectedResult.conflicts.length,1);
 const duplicate={...rows[0],id:'ANOTHER-ID'};const conflict=await importV5(db,[duplicate],{...options,checksum:'test-identity'});assert.equal(conflict.skipped,1);assert.equal(await db.ingredientCatalog.count(),2893);
 assert.equal((await db.ingredientCatalog.findUnique({where:{id:'HUMAI-V5-01649'}})).reviewRequired,true);
 console.log('PASS v5 upgrade, stable identities, repeat import, local search, servings, recipe yield, source precedence and historical preservation');
 }finally{if(user){await db.foodLog.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});}await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
