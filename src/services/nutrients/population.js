const {importNutrients,prepareRecord,identityKey}=require('../nutrientImport');
const {NUTRIENTS}=require('../nutrientMaster');
const {choose,indianPriority}=require('./matching');
const {VERSION}=require('./sources');
function coverage(ingredients,profiles) {
 const verified=profiles.filter(p=>p.verifiedAt), covered=new Set(verified.map(p=>p.ingredientId));
 const known=new Map(NUTRIENTS.map(n=>[n.code,new Set()]));
 const bySource={}, preparationCounts={};
 for(const p of verified) {
  bySource[p.source]=(bySource[p.source]||0)+1;preparationCounts[p.preparationType]=(preparationCounts[p.preparationType]||0)+1;
  for(const n of p.nutrients) if(n.amountPer100g!=null) known.get(n.nutrient.code)?.add(p.ingredientId);
 }
 return {totalIngredients:ingredients.length,ingredientsWithVerifiedProfiles:covered.size,ingredientsMissingVerifiedProfiles:ingredients.length-covered.size,verifiedProfiles:verified.length,sourceDistribution:bySource,preparationCounts,
 rawProfiles:preparationCounts.RAW||0,cookedProfiles:verified.filter(p=>['BOILED','STEAMED','FRIED','ROASTED'].includes(p.preparationType)||/\b(?:cooked|baked)\b/i.test(p.preparationMethod||'')).length,
 nutrientCoverage:NUTRIENTS.map(n=>({code:n.code,ingredientsWithKnownAmount:known.get(n.code).size,percentOfAllIngredients:ingredients.length?Number((100*known.get(n.code).size/ingredients.length).toFixed(2)):0})),
 missingIngredients:ingredients.filter(i=>!covered.has(i.id)).map(i=>({id:i.id,name:i.name,priority:indianPriority(i)?'INDIAN_STAPLE':'NORMAL'})).sort((a,b)=>a.priority.localeCompare(b.priority)||a.name.localeCompare(b.name))};
}
async function populate(prisma,sources,{apply=false,batchSize=25,overrides=[],checkpoint=()=>{}}={}) {
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100) throw Error('Batch size must be 1–100');
 const ingredients=await prisma.ingredient.findMany({include:{catalog:true},orderBy:{id:'asc'}});
 const readProfiles=()=>prisma.ingredientNutritionProfile.findMany({include:{nutrients:{include:{nutrient:true}}}});
 const before=await readProfiles();const existing=new Map(before.map(p=>[p.identityKey,p]));
 const report={version:VERSION,generatedAt:new Date().toISOString(),applied:apply,processedIngredients:ingredients.length,importedProfilesThisRun:0,results:[],before:coverage(ingredients,before)};
 const queued=[];
 for(const ingredient of ingredients) {
   const match=choose(ingredient,sources,overrides);
   if(match.status!=='MATCHED') {report.results.push({ingredientId:ingredient.id,name:ingredient.name,priority:indianPriority(ingredient)?'INDIAN_STAPLE':'NORMAL',...match});continue;}
   for(const source of match.sources) {
    const outcome={ingredientId:ingredient.id,name:ingredient.name,source:source.source,sourceFoodId:source.sourceFoodId,confidence:match.confidence,missingNutrients:NUTRIENTS.filter(n=>!source.nutrients.some(v=>v.code===n.code && v.amountPer100g!=null)).map(n=>n.code)};
    try {
     const record={...source,ingredientId:ingredient.id};
     if(match.reviews) record.sourceCitation=JSON.stringify({source:source.sourceCitation,matchReview:match.reviews.find(r=>r.source===source.source && String(r.sourceFoodId)===source.sourceFoodId)});
     const normalized=prepareRecord(record), key=identityKey(ingredient.id,normalized), old=existing.get(key);
     if(old?.verifiedAt && old.nutrients.some(n=>n.amountPer100g!=null && normalized.nutrients.some(v=>v.code===n.nutrient.code && v.amountPer100g!=null && !n.amountPer100g.equals(v.amountPer100g)))) {report.results.push({...outcome,status:'REVIEW_REQUIRED',reason:'VERIFIED_VALUE_CONFLICT'});continue;}
     // A restart rechecks persisted values, not just a potentially stale checkpoint file.
     if(old?.verifiedAt && normalized.nutrients.every(n=>n.amountPer100g==null || old.nutrients.some(v=>v.nutrient.code===n.code && v.amountPer100g?.equals(n.amountPer100g)))) {report.results.push({...outcome,status:'ALREADY_IMPORTED',profileId:old.id});continue;}
     queued.push({record,outcome});
    } catch(e) {report.results.push({...outcome,status:'FAILED',reason:e.message});}
   }
 }
 for(let offset=0;offset<queued.length;offset+=batchSize) {
  const batch=queued.slice(offset,offset+batchSize);
  try {
   const result=await importNutrients(prisma,batch.map(x=>x.record),{apply,preserveVerified:true});
   for(const item of result.records) {report.results.push({...batch[item.index].outcome,...item});if(['CREATED','UPSERTED'].includes(item.status))report.importedProfilesThisRun++;}
  } catch(e) {for(const x of batch) report.results.push({...x.outcome,status:'FAILED',reason:e.code||e.message});}
  await checkpoint(report);
 }
 report.after=coverage(ingredients,await readProfiles());
 report.manualReview=report.results.filter(r=>r.status==='REVIEW_REQUIRED');
 report.failedImports=report.results.filter(r=>r.status==='FAILED');
 report.pendingImports=report.results.filter(r=>r.status==='PENDING');
 await checkpoint(report);return report;
}
module.exports={coverage,populate};
