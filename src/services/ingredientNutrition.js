const {getPrisma}=require('../lib/prisma');const {httpError}=require('../lib/errors');const {scale,recipe,fromIngredient}=require('./nutrition');
async function getIngredient(id,db=getPrisma()){
 if(typeof id!=='string'||id.length>120)throw httpError(400,'Invalid ingredient ID');
 const item=await db.ingredient.findUnique({where:{id},include:{catalog:true,servings:true}});
 if(!item || (item.catalog && !item.catalog.usable))throw httpError(404,'Ingredient unavailable');return item;
}
function provenance(i){const r=i.catalog?.sourceRecord || i.sourceMetadata || {};return {ingredientId:i.id,catalogId:i.catalogId||null,name:i.name,source:i.source,verificationLevel:i.catalog?.verificationLevel||null,revision:i.catalog?.importBatch||null,sourceRecord:r,carbohydrateBasis:'total',nutritionBasis:'PER_100_G',calculation:'per100g × grams / 100',reviewRequired:i.catalog?.reviewRequired||false};}
// Volume→mass is allowed ONLY with a food-specific density on the ingredient
// record. There is no generic 1ml=1g fallback — without density evidence the
// conversion is refused instead of fabricating mass.
function gramsFromVolume(item,ml){
 const d=item.densityGPerMl;
 if(!Number.isFinite(d)||d<=0||d>3)throw httpError(400,'volume_requires_density');
 return ml*d;
}
async function calculate(id,{grams,servingId,count=1,volumeMl}={},db=getPrisma()){
 const item=await getIngredient(id,db);let serving=null,densityUsed=null,volumeNative=null;
 if(servingId){serving=item.servings.find(s=>s.id===servingId);if(!serving || !Number.isFinite(count)||count<=0||count>1000)throw httpError(400,'Invalid serving');
  if(serving.ml!=null){
   if(Number.isFinite(item.densityGPerMl)&&item.densityGPerMl>0&&item.densityGPerMl<=3){densityUsed=item.densityGPerMl;grams=gramsFromVolume(item,serving.ml)*count;}
   else volumeNative={volumeMl:serving.ml*count};
  }
  else grams=serving.grams*count;}
 else if(volumeMl!=null){const v=Number(volumeMl);if(!Number.isFinite(v)||v<=0||v>100000)throw httpError(400,'Invalid volumeMl');
  if(Number.isFinite(item.densityGPerMl)&&item.densityGPerMl>0&&item.densityGPerMl<=3){densityUsed=item.densityGPerMl;grams=gramsFromVolume(item,v);}
  else volumeNative={volumeMl:v};}
 // Volume-native path (decisions #111/#144/#155): a volume-declared ingredient
 // without documented density is NEVER mass-converted (never 1ml=1g). Nutrition
 // scales by the declared per-100mL basis through the approved pure helper;
 // mass stays honestly null.
 if(volumeNative){
  const declared={basis:'PER_100_ML',nutrients:fromIngredient(item)};
  const out=require('./nutrition').calculateDeclared(declared,{volumeMl:volumeNative.volumeMl});
  return {nutrition:out.nutrition,grams:null,volumeMl:volumeNative.volumeMl,nutritionBasis:'PER_100_ML',serving:serving?{id:serving.id,label:serving.label,grams:serving.grams,ml:serving.ml??null,count,estimated:serving.estimated,source:serving.sourceRecord}:null,densityGPerMl:null,provenance:{...provenance(item),nutritionBasis:'PER_100_ML',conversion:'volume-native: declared per-100mL × ml/100 — mass unknown (no documented density)',calculation:out.calculation}};
 }
 const nutrition=scale(fromIngredient(item),grams);
 return {nutrition,grams,serving:serving?{id:serving.id,label:serving.label,grams:serving.grams,ml:serving.ml??null,count,estimated:serving.estimated,source:serving.sourceRecord}:null,densityGPerMl:densityUsed??null,provenance:{...provenance(item),conversion:densityUsed!=null?`volume_ml × ${densityUsed} g/ml → grams`:'direct grams'}};
}
async function calculateRecipe(parts,yieldGrams,db=getPrisma()){
 if(!Array.isArray(parts)||!parts.length||parts.length>100)throw httpError(400,'Recipe needs 1–100 ingredients');
 const inputs=[];for(const p of parts){const item=await getIngredient(p.ingredientId,db);inputs.push({per100g:fromIngredient(item),grams:p.grams,provenance:provenance(item)});}
 return {...recipe(inputs,yieldGrams),ingredients:inputs.map(p=>({grams:p.grams,...p.provenance}))};
}
module.exports={getIngredient,calculate,calculateRecipe,provenance};
