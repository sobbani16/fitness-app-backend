const {getPrisma}=require('../lib/prisma');const {httpError}=require('../lib/errors');const {scale,recipe,fromIngredient}=require('./nutrition');
async function getIngredient(id,db=getPrisma()){
 if(typeof id!=='string'||id.length>120)throw httpError(400,'Invalid ingredient ID');
 const item=await db.ingredient.findUnique({where:{id},include:{catalog:true,servings:true}});
 if(!item || (item.catalog && !item.catalog.usable))throw httpError(404,'Ingredient unavailable');return item;
}
function provenance(i){const r=i.catalog?.sourceRecord || i.sourceMetadata || {};return {ingredientId:i.id,catalogId:i.catalogId||null,name:i.name,source:i.source,verificationLevel:i.catalog?.verificationLevel||null,revision:i.catalog?.importBatch||null,sourceRecord:r,carbohydrateBasis:'total',calculation:'per100g × grams / 100',reviewRequired:i.catalog?.reviewRequired||false};}
async function calculate(id,{grams,servingId,count=1}={},db=getPrisma()){
 const item=await getIngredient(id,db);let serving=null;
 if(servingId){serving=item.servings.find(s=>s.id===servingId);if(!serving || !Number.isFinite(count)||count<=0||count>1000)throw httpError(400,'Invalid serving');grams=serving.grams*count;}
 const nutrition=scale(fromIngredient(item),grams);return {nutrition,grams,serving:serving?{id:serving.id,label:serving.label,grams:serving.grams,count,estimated:serving.estimated,source:serving.sourceRecord}:null,provenance:provenance(item)};
}
async function calculateRecipe(parts,yieldGrams,db=getPrisma()){
 if(!Array.isArray(parts)||!parts.length||parts.length>100)throw httpError(400,'Recipe needs 1–100 ingredients');
 const inputs=[];for(const p of parts){const item=await getIngredient(p.ingredientId,db);inputs.push({per100g:fromIngredient(item),grams:p.grams,provenance:provenance(item)});}
 return {...recipe(inputs,yieldGrams),ingredients:inputs.map(p=>({grams:p.grams,...p.provenance}))};
}
module.exports={getIngredient,calculate,calculateRecipe,provenance};
