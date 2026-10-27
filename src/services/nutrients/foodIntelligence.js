const {createHash}=require('node:crypto');
const {Prisma}=require('@prisma/client');
const {getPrisma}=require('../../lib/prisma');
const {NUTRIENTS}=require('../nutrientMaster');
const {evaluate}=require('./conditionEvaluation');
const VERSION='food-intelligence/4.0.0';
const LABEL={calories:'ENERGY_KCAL',proteinG:'PROTEIN',carbsG:'CARBOHYDRATE_TOTAL',fatG:'FAT_TOTAL',saturatedFatG:'FAT_SATURATED',transFatG:'FAT_TRANS',fiberG:'FIBER',sugarG:'SUGAR_TOTAL',addedSugarG:'SUGAR_ADDED',sodiumMg:'SODIUM'};
const cache=new Map();
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<=100000;
function empty(foodId,reason){return {foodId,servingSize:null,healthConditionMatches:[],nutrientFindings:[],ingredientFindings:[],warnings:[],positiveFindings:[],evidenceReferences:[],missingData:[reason],requiresPersonalization:false,evaluationVersion:VERSION,nutritionSummary:[],dataQuality:'UNKNOWN'};}
async function contextFor(userId,db) {
 const conditions=await db.userHealthCondition.findMany({where:{userId,active:true},include:{condition:true}});
 const ids=conditions.map(c=>c.conditionId);
 const [nutrientRules,ingredientRules,masters]=await Promise.all([
  db.healthConditionNutrientRule.findMany({where:{healthConditionId:{in:ids},reviewStatus:'APPROVED'},include:{nutrient:true,evidence:true,healthCondition:true}}),
  db.conditionRule.findMany({where:{conditionId:{in:ids},target:'clinical_ingredient',reviewStatus:'APPROVED'},include:{evidence:true,condition:true}}),
  db.nutrient.findMany(),
 ]);
 return {conditions,nutrientRules,ingredientRules,masters};
}
function format(foodId,profile,grams,ctx,quality,missing=[],ingredientEvidence=[]) {
 const evaluated=evaluate({...ctx,profile,servingGrams:grams,ingredientEvidence});
 const findings=evaluated.findings.map(f=>({
  id:hash([f.ruleCode,f.version,f.condition.id,profile?.id,grams]),ruleId:f.ruleId,ruleVersion:f.version,
  conditionId:f.condition.id,conditionName:f.condition.name||'',nutrientId:f.matchedNutrient?.id||null,ingredientId:f.matchedIngredient?.id||null,
  nutrientName:f.matchedNutrient?.name||null,action:f.action,severity:f.severity,actualAmount:f.actualQuantity,applicableThreshold:f.threshold,
  explanation:f.explanation,evidenceSource:f.evidence,confidence:quality,status:f.status,reason:f.reason,
  labelEvidence:f.matchedIngredient?.attributeEvidence||null,personalizationRequirements:f.personalizationRequirements,
 }));
 const result={...empty(foodId,''),servingSize:positive(grams)?{value:grams,unit:'g'}:null,dataQuality:quality,
  healthConditionMatches:[...new Map(findings.map(f=>[f.conditionId,{id:f.conditionId,name:f.conditionName}])).values()],
  nutrientFindings:findings.filter(f=>f.nutrientId),ingredientFindings:findings.filter(f=>f.ingredientId),
  positiveFindings:findings.filter(f=>f.action==='PRIORITIZE'&&f.status==='GUIDANCE'),
  evidenceReferences:[...new Map(findings.filter(f=>f.evidenceSource).map(f=>[f.evidenceSource.id,f.evidenceSource])).values()],
  missingData:[...missing,...(evaluated.conditionsWithoutApprovedFindings.length?['No applicable approved finding is available for one or more saved conditions. This is not a safety verdict.']:[])],
  requiresPersonalization:evaluated.conflicts.length>0||findings.some(f=>f.status==='PERSONALIZATION_REQUIRED'),conflicts:evaluated.conflicts,
  nutritionSummary:NUTRIENTS.map(n=>{const master=ctx.masters.find(m=>m.code===n.code);const v=profile?.nutrients?.find(v=>v.nutrientId===master?.id)?.amountPer100g;return {code:n.code,name:n.name,unit:n.unit,value:v!=null&&positive(grams)?new Prisma.Decimal(v).mul(grams).div(100).toFixed(6):null,origin:quality};}),
 };
 // Group for presentation without discarding each condition's evidence-backed finding.
 const groups=new Map();
 for(const f of findings){const key=hash([f.nutrientId,f.ingredientId,f.action,f.status,f.explanation]);if(!groups.has(key))groups.set(key,{...f,conditionNames:[],findingIds:[]});groups.get(key).conditionNames.push(f.conditionName);groups.get(key).findingIds.push(f.id);}
 result.warnings=[...groups.values()];
 return result;
}
function memo(userId,input,ctx,build){
 // Include complete versions, evidence and quantities; never cache by user ID alone.
 const key=hash([userId,VERSION,input,ctx]);const old=cache.get(key);
 if(old&&old.expires>Date.now())return structuredClone(old.value);
 const value=build();if(cache.size>=100)cache.delete(cache.keys().next().value);
 cache.set(key,{expires:Date.now()+60000,value});return structuredClone(value);
}
async function label(facts,userId,db) {
 const ctx=facts.personalize?await contextFor(userId,db||getPrisma()):{conditions:[],nutrientRules:[],ingredientRules:[],masters:NUTRIENTS.map(n=>({...n,id:n.code}))};
 return memo(userId,facts,ctx,()=>{
  const mass=facts.basisUnit==='g'?facts.basisAmount:facts.basisMassG;
  const valid=facts.reviewed&&positive(mass)&&positive(facts.portionRatio)&&facts.column!=='unknown';
  const profile={id:'reviewed-label',ingredientId:'reviewed-label',verifiedAt:valid?new Date().toISOString():null,sourceCitation:'User-reviewed package nutrition; not laboratory verification',nutrients:[],ingredient:{attributes:[]}};
  for(const [field,code] of Object.entries(LABEL)){const n=ctx.masters.find(n=>n.code===code);if(n)profile.nutrients.push({nutrientId:n.id,amountPer100g:valid&&facts[field]!=null?new Prisma.Decimal(facts[field]).mul(100).div(mass).toString():null});}
  const evidence=[];
  const {labelMatch}=require('../labelInsights');
  for(const [attribute,pattern] of [['CONTAINS_GLUTEN',/\b(?:maida|wheat|barley|rye)\b/i],['CONTAINS_HIGH_FRUCTOSE_CORN_SYRUP',/\bhigh[- ]fructose\s+corn\s+syrup\b/i],['CONTAINS_LACTOSE',/\blactose\b/i]]){
   const match=attribute==='CONTAINS_GLUTEN'&&/gluten[- ]free|wheat\s+starch/i.test(facts.ingredients)?null:labelMatch(facts.ingredients,pattern);
   if(match&&facts.reviewed){profile.ingredient.attributes.push({attribute});evidence.push({attribute,ingredientId:'reviewed-label',evidence:match[0],origin:'USER_REVIEWED_LABEL',verifiedAt:new Date().toISOString()});}
  }
  const result=format(null,profile,valid?mass*facts.portionRatio:null,ctx,facts.reviewed?'USER_REVIEWED_LABEL':'UNREVIEWED_OCR',valid?[]:['Confirm the nutrition column, label mass and consumed portion. Volume is not assumed to equal mass.'],evidence);
  result.servingsPerContainer=facts.servingsPerContainer??null;
  result.portionRatio=facts.portionRatio;
  return result;
 });
}
async function profilesForIngredient(ingredientId,db=getPrisma()) {
 return db.ingredientNutritionProfile.findMany({where:{ingredientId,verifiedAt:{not:null}},select:{id:true,ingredientId:true,preparationType:true,preparationMethod:true,source:true,sourceFoodId:true,sourceDataset:true,updatedAt:true}});
}
async function ingredient({ingredientId,profileId,grams},userId,db=getPrisma()) {
 if(!positive(grams))return empty(ingredientId,'Enter the consumed weight in grams.');
 if(!profileId)return empty(ingredientId,'Select an exact raw/cooked nutrition profile. Existing macro logging remains available.');
 const [ctx,profile]=await Promise.all([contextFor(userId,db),db.ingredientNutritionProfile.findFirst({where:{id:profileId,ingredientId,verifiedAt:{not:null}},include:{nutrients:true,ingredient:{include:{attributes:true}}}})]);
 if(!profile)return empty(ingredientId,'A verified profile matching this ingredient was not found.');
 return memo(userId,{profile,grams},ctx,()=>format(ingredientId,profile,grams,ctx,'VERIFIED_DATABASE'));
}
function aggregateRecipe(recipe,profiles,masters,portionGrams) {
 const missing=[],parts=recipe.ingredients||[],byId=new Map(profiles.map(p=>[p.id,p]));
 const yieldG=recipe.nutritionSource?.yieldGrams;
 const selected=parts.map(part=>({part,profile:byId.get(part.nutritionSnapshot?.nutritionProfileId)}));
 const validParts=selected.length>0&&selected.every(({part,profile})=>profile?.verifiedAt&&profile.ingredientId===part.ingredientId&&positive(part.amountG));
 if(!validParts)missing.push('One or more ingredients lack an explicit verified preparation profile or amount.');
 if(!positive(yieldG))missing.push('Measured recipe yield is missing; per-portion nutrient totals are unknown.');
 // Only an operator-reviewed retention declaration can establish a finished recipe total.
 const retention=recipe.nutritionSource?.retention;
 const retained=retention?.reviewed===true&&typeof retention.source==='string'&&retention.source.trim()&&retention.factors;
 if(!retained)missing.push('Cooking retention is not verified. Ingredient sums are approximate, not finished-food measurements.');
 const nutrients=masters.map(n=>{
  const amounts=selected.map(({part,profile})=>{const v=profile?.nutrients.find(v=>v.nutrientId===n.id)?.amountPer100g;return v==null?null:new Prisma.Decimal(v).mul(part.amountG||0).div(100);});
  let value=validParts&&positive(yieldG)&&amounts.every(v=>v!=null)?amounts.reduce((a,b)=>a.plus(b),new Prisma.Decimal(0)).mul(100).div(yieldG):null;
  const factor=retained?retention.factors[n.code]:null;
  if(retained&&(typeof factor!=='number'||!Number.isFinite(factor)||factor<0||factor>1))value=null;
  else if(value!=null&&retained)value=value.mul(factor);
  return {nutrientId:n.id,amountPer100g:value?.toString()??null};
 });
 return {profile:{id:recipe.id,ingredientId:recipe.id,verifiedAt:retained&&validParts&&positive(yieldG)?new Date().toISOString():null,nutrients,sourceCitation:retained?retention.source:'Approximate sum of preparation-specific ingredient records',ingredient:{attributes:[]}},grams:positive(portionGrams)?portionGrams:positive(yieldG)&&positive(recipe.servings)?yieldG/recipe.servings:null,missing,quality:retained?'VERIFIED_RECIPE_CALCULATION':'APPROXIMATE_RECIPE_CALCULATION'};
}
async function recipes(recipes,userId,db=getPrisma(),portionGrams) {
 const ids=[...new Set(recipes.flatMap(r=>(r.ingredients||[]).map(i=>i.nutritionSnapshot?.nutritionProfileId).filter(Boolean)))];
 const [ctx,profiles]=await Promise.all([contextFor(userId,db),db.ingredientNutritionProfile.findMany({where:{id:{in:ids},verifiedAt:{not:null}},include:{nutrients:true}})]);
 return recipes.map(r=>memo(userId,{r,profiles,portionGrams},ctx,()=>{const portion=typeof portionGrams==='object'?portionGrams[r.id]:portionGrams;const a=aggregateRecipe(r,profiles,ctx.masters,portion);return format(r.id,a.profile,a.grams,ctx,a.quality,a.missing);}));
}
async function safe(task,foodId){try{return await task();}catch{return empty(foodId,'Personalized analysis is temporarily unavailable. Food logging remains available.');}}
module.exports={VERSION,LABEL,label,ingredient,recipes,aggregateRecipe,contextFor,format,profilesForIngredient,safe,empty,cache};
