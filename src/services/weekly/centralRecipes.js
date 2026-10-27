// Exact FDC identities for the reviewed recipe library. No name/preparation matching.
const {httpError}=require('../../lib/errors');
const {recipe:calculateRecipe,fromIngredient}=require('../nutrition');
const snapshot=require('../../data/weekly-nutrients.json');
async function importReviewedIngredients(db){
 for(const food of Object.values(snapshot.foods)){
  const fdcId=String(food.fdcId);const current=await db.ingredient.findUnique({where:{fdcId}});
  if(current){
   // Keep existing lookup nutrition intact; reviewed recipes bind to an explicit source revision.
   const metadata=current.sourceMetadata || {};
   if(!metadata.reviewedProfiles?.[snapshot.version])await db.ingredient.update({where:{id:current.id},data:{sourceMetadata:{...metadata,reviewedProfiles:{...(metadata.reviewedProfiles||{}),[snapshot.version]:food}}}});
   continue;
  }
  const n=food.per100g;
  await db.ingredient.upsert({where:{fdcId},update:{},create:{fdcId,name:food.description,normalizedName:food.description.toLowerCase(),source:'usda',caloriesPer100g:n.calories,proteinPer100g:n.proteinG,carbsPer100g:n.carbsG,fatPer100g:n.fatG,fiberPer100g:n.fiberG,sourceMetadata:{...food,provider:snapshot.source,retrievedAt:snapshot.retrievedAt,carb_definition:'total carbohydrate (USDA by difference)',importVersion:snapshot.version}}});
 }
}
async function resolveRecipes(recipes,db){
 const ids=[...new Set(recipes.flatMap(r=>(r.nutritionSource?.ingredients||[]).map(i=>String(i.fdcId))))];
 if(!ids.length)return recipes;
 const records=await db.ingredient.findMany({where:{fdcId:{in:ids}},include:{catalog:true}});const byId=new Map(records.map(r=>[r.fdcId,r]));
 return recipes.map(r=>{
  if(r.nutritionSource?.version!==snapshot.version)return r;
  const parts=r.nutritionSource.ingredients.map(source=>{
   const i=byId.get(String(source.fdcId));if(!i)throw httpError(503,'Reviewed recipe ingredient cache is not imported');
   const reviewed=i.sourceMetadata?.reviewedProfiles?.[snapshot.version];
   const n=reviewed ? reviewed.per100g : fromIngredient(i);
   // Older recipe versions stay immutable; changed reviewed sources need a new recipe version.
   if(['calories','proteinG','carbsG','fatG','fiberG'].some(k=>n[k]!==source.per100g[k]))throw httpError(409,'Reviewed recipe source changed; a new recipe revision is required');
   return {per100g:n,grams:source.grams};
  });
  const result=calculateRecipe(parts,r.portionG);
  return {...r,...Object.fromEntries(['calories','proteinG','carbsG','fatG','fiberG'].map(k=>[k,Math.round(result.totals[k]*10)/10]))};
 });
}
module.exports={importReviewedIngredients,resolveRecipes};
