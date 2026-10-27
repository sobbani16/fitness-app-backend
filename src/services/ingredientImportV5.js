const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validate,normalize,identity } = require('./ingredientCsv');
const { totalCarbs } = require('./nutrition');
const extraAliases=require('../../data/imports/ingredient-aliases.json');
const ranks={SOURCE_BACKED_FULL:4,PARTIALLY_SOURCE_BACKED:3,GENERIC_COMPOSITION:2,ESTIMATED:1,REVIEW_CONFLICT:0};
function legacyLevel(r){return r.nutrition_verification_level || (r.status==='SOURCE_MEASURED' ? 'SOURCE_BACKED_FULL' : ['GENERIC_COMPOSITION','IDENTITY_DERIVED'].includes(r.status) ? 'GENERIC_COMPOSITION' : 'ESTIMATED');}
function usable(r){return [r.kcal_per_100g,r.protein_g_per_100g,totalCarbs(r),r.fat_g_per_100g].every(n=>typeof n==='number'&&Number.isFinite(n));}
async function importV5(db,rows,{apply=false,checksum,filename='catalog.csv'}={}) {
 validate(rows);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982480)`;
  const oldRows=await tx.ingredientCatalog.findMany({include:{ingredient:true}}), oldById=new Map(oldRows.map(r=>[r.id,r]));
  const identities=new Map();for(const r of oldRows){const key=identity(r.sourceRecord);identities.set(key,[...(identities.get(key)||[]),r]);}
  const report={input:rows.length,matched:0,updated:0,inserted:0,skipped:0,conflicts:[],errors:[],totalCatalog:oldRows.length,levels:{},reviewRequired:rows.filter(r=>r.nutrition_verification_level==='REVIEW_CONFLICT').map(r=>r.id),applied:apply};
  const newCatalogs=[],newIngredients=[],servings=[],changedServingIds=[];
  for(const row of rows){
   report.levels[row.nutrition_verification_level]=(report.levels[row.nutrition_verification_level]||0)+1;
   const old=oldById.get(row.id);
   const aliases=[...new Set([...String(row.search_aliases||'').split(';'),...(extraAliases[row.id]||[])].map(normalize).filter(Boolean))];
   if(!old && identities.has(identity(row))){report.conflicts.push({id:row.id,reason:'Identity exists under another ID; explicit mapping required',candidates:identities.get(identity(row)).map(x=>x.id)});report.skipped++;continue;}
   if(old)report.matched++;
   // Stable IDs remain primary. Changing identifying brand/preparation/source IDs needs review.
   if(old && ['brand','restaurant_chain','preparation','source_id'].some(k=>old.sourceRecord[k] && row[k] && normalize(old.sourceRecord[k])!==normalize(row[k]))){report.conflicts.push({id:row.id,reason:'Stable ID identity fields changed'});report.skipped++;continue;}
   if(old && old.usable && ranks[legacyLevel(old.sourceRecord)]>ranks[row.nutrition_verification_level]){report.conflicts.push({id:row.id,reason:'Existing higher-confidence source preserved'});report.skipped++;continue;}
   if(old && isDeepStrictEqual(old.sourceRecord,row) && old.importBatch===checksum && isDeepStrictEqual(old.aliases,aliases)){report.skipped++;continue;}
   const data={name:row.name,normalizedName:normalize(row.name),aliases,category:row.category||'',preparation:row.preparation||'',status:row.status,usable:usable(row),sourceRecord:row,verificationLevel:row.nutrition_verification_level,brand:row.brand||null,restaurantChain:row.restaurant_chain||null,market:row.market||null,foodType:row.food_type||null,cuisine:row.cuisine||null,identityKey:identity(row),importBatch:checksum,reviewRequired:row.nutrition_verification_level==='REVIEW_CONFLICT'};
   if(old)report.updated++;else{report.inserted++;report.totalCatalog++;}
   if(!apply)continue;
   changedServingIds.push(`catalog:${row.id}:default`);
   if(old)await tx.ingredientCatalog.update({where:{id:row.id},data});else newCatalogs.push({id:row.id,...data});
   if(!data.usable)continue;
   const id=old?.ingredient?.id || randomUUID();
   const values={name:row.name,normalizedName:data.normalizedName,catalogId:row.id,caloriesPer100g:row.kcal_per_100g,proteinPer100g:row.protein_g_per_100g,carbsPer100g:totalCarbs(row),fatPer100g:row.fat_g_per_100g,fiberPer100g:row.fiber_g_per_100g,source:'humai-catalog'};
   if(old?.ingredient)await tx.ingredient.update({where:{id},data:values});else newIngredients.push({id,...values});
   if(row.serving_g_assumed>0)servings.push({id:`catalog:${row.id}:default`,ingredientId:id,label:row.serving_label||`${row.serving_g_assumed} g`,grams:row.serving_g_assumed,estimated:!/official/i.test(row.serving_source_basis||'') || row.nutrition_verification_level!=='SOURCE_BACKED_FULL',sourceRecord:{label:row.serving_label,grams:row.serving_g_assumed,basis:row.serving_source_basis,calories:row.serving_kcal,proteinG:row.serving_protein_g,carbsG:row.serving_carbs_g,fatG:row.serving_fat_g,fiberG:row.serving_fiber_g}});
  }
  if(apply){
   if(newCatalogs.length)await tx.ingredientCatalog.createMany({data:newCatalogs});
   if(newIngredients.length)await tx.ingredient.createMany({data:newIngredients});
   if(changedServingIds.length)await tx.ingredientServing.deleteMany({where:{id:{in:changedServingIds}}});
   if(servings.length)await tx.ingredientServing.createMany({data:servings});
   await tx.ingredientImport.create({data:{checksum,filename,report}});
  }
  return report;
 },{timeout:600000});
}
module.exports={importV5,legacyLevel,usable};
