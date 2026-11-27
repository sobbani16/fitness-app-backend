const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const intelligence=require('../services/nutrients/foodIntelligence');
router.get('/profiles/:ingredientId',async(req,res,next)=>{try{res.json({profiles:await intelligence.profilesForIngredient(req.params.ingredientId)});}catch(e){next(e);}});
router.post('/intelligence',async(req,res,next)=>{try{
 const b=req.body||{};
 if(typeof b.ingredientId!=='string'||b.ingredientId.length>120||(b.profileId!=null&&(typeof b.profileId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.profileId))))throw httpError(400,'Invalid ingredient/profile');
 const userId=req.userId||req.headers['x-user-id'];
 const intel=await intelligence.safe(()=>intelligence.ingredient({ingredientId:b.ingredientId,profileId:b.profileId,grams:b.grams,consumedState:['raw','cooked'].includes(b.consumedState)?b.consumedState:undefined,yieldFactor:Number.isFinite(b.yieldFactor)?b.yieldFactor:undefined},userId),b.ingredientId);
 // Sprint C: goal-aware portion impact — computed from the SAME verified
 // profile nutrients; unknown nutrients stay 'unverified'. Substitution
 // screening uses server-loaded allergen terms only.
 let impact=null,substitutions=null;
 try{
  const p=getPrisma();
  const [u,goal,allergies]=await Promise.all([p.user.findUnique({where:{id:userId},select:{goalType:true}}),p.macroGoal.findUnique({where:{userId}}),p.userAllergy.findMany({where:{userId},select:{allergy:{select:{name:true}}}})]);
  const canon=require('../services/calorieEngine').normalizeGoal(u?.goalType)||'maintenance';
  const nutrientRows=intel?.nutrients||intel?.profile?.nutrients||[];
  const NAME2KEY={calories:'calories',protein:'proteinG','total carbohydrate':'carbsG',carbohydrate:'carbsG','total fat':'fatG',fat:'fatG',fiber:'fiberG','dietary fiber':'fiberG'};
  const per={};
  for(const n of nutrientRows){
   const key=NAME2KEY[String(n.nutrient?.name||n.code||'').toLowerCase()];if(!key)continue;
   const per100=n.valuePer100g??n.per100g??n.value??null;
   if(per100!=null&&Number.isFinite(Number(per100)))per[key]=Math.round(Number(per100)*b.grams)/100;
  }
  const meal={foodName:intel?.ingredient?.name||intel?.name||'logged food',quantityG:b.grams,calories:per.calories??null,proteinG:per.proteinG??null,carbsG:per.carbsG??null,fatG:per.fatG??null,fiberG:per.fiberG??null};
  // Phase 1: server-derived classification — client-supplied categoryId is
  // never authoritative. classifyFood runs on verified per-100g nutrients +
  // name hints; multiple labels possible. Primary category for education =
  // first label with a CATEGORIES entry.
  const impactMod=require('../services/ingredientImpact');
  const cls=impactMod.classifyFood({name:meal.foodName,per100:per,categoryRole:null});
  const catId=cls.categories.find(c=>impactMod.CATEGORIES[c])||null;
  impact=impactMod.evaluatePortion({meal,goal:canon,targets:goal||{},categoryId:catId});
  impact.classification=cls;
  substitutions=impactMod.suggestSubstitutions({meal,goal:canon,categoryId:catId,allergenTerms:new Set((allergies||[]).map(a=>String(a.allergy?.name||'').toLowerCase()).filter(Boolean))});
 }catch{/* impact is best-effort — profile payload unaffected */}
 res.json({...intel,impact,substitutions});
}catch(e){next(e);}});
router.post('/',async(req,res,next)=>{
 try {
  const userId=req.userId || req.headers['x-user-id'];
  const b=req.body || {};
  if (!userId || typeof b.foodName !== 'string' || !b.foodName.trim()) throw httpError(400,'foodName required');
  if (typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(b.id)) throw httpError(400,'Stable meal id required');
  const data={foodName:b.foodName.slice(0,300),mealType:String(b.mealType||'meal').slice(0,30)};
  for(const k of ['quantityG','calories','proteinG','carbsG','fatG','fiberG']) {
   if(k==='fiberG' && b[k]==null){data[k]=null;continue;}
   const n=b[k]; if(!Number.isFinite(n)||n<0||n>100000)throw httpError(400,`Invalid ${k}`); data[k]=n;
  }
  const loggedAt=b.loggedAt ? new Date(b.loggedAt) : new Date();
  if(!Number.isFinite(loggedAt.getTime())||loggedAt.getTime()>Date.now()+300000)throw httpError(400,'Invalid loggedAt');
  const prisma=getPrisma();
  // Compound identity cannot overwrite another user's record. Repeated delivery is a no-op.
  const existing=await prisma.foodLog.findUnique({where:{id:b.id}});
  if(existing){if(existing.userId!==userId)throw httpError(409,'Meal id conflict');return res.json(existing);}
  if(b.ingredientId){
   // servingId + servingCount make the catalog the authoritative conversion;
   // quantityG alone stays supported for weight entries.
   const servingCount=Number.isFinite(Number(b.servingCount))&&Number(b.servingCount)>0?Number(b.servingCount):undefined;
   const calculated=typeof b.servingId==='string'&&b.servingId
     ?await require('../services/ingredientNutrition').calculate(b.ingredientId,{servingId:b.servingId,count:servingCount??1})
     :await require('../services/ingredientNutrition').calculate(b.ingredientId,{grams:data.quantityG});
   if(calculated.serving){
    data.quantityG=calculated.grams;
    // The serving path converts count×grams server-side and bypasses the
    // direct quantityG bound above — enforce the same cap here so
    // count=1000 against a large serving can't persist absurd portions.
    if(!Number.isFinite(data.quantityG)||data.quantityG>100000)throw httpError(400,'Invalid serving count');
   }
   const edited=['calories','proteinG','carbsG','fatG','fiberG'].some(k=>data[k]!=null && (calculated.nutrition[k]==null || Math.abs(data[k]-calculated.nutrition[k])>(k==='calories'?0.51:0.051)));
   data.ingredientId=b.ingredientId;
   const catalogRevisionAtSelection=typeof b.catalogRevision==='string'?b.catalogRevision.slice(0,64):null;
   data.nutritionSnapshot={...calculated.provenance,catalogRevisionAtSelection,catalogChangedSinceSelection:!!catalogRevisionAtSelection && catalogRevisionAtSelection!==calculated.provenance.revision,grams:data.quantityG,loggedFoodName:data.foodName,selectedServing:b.selectedServing && typeof b.selectedServing==='string'?b.selectedServing.slice(0,200):null,servingId:typeof b.servingId==='string'?b.servingId.slice(0,80):calculated.serving?.id??null,servingGrams:calculated.serving?.grams??null,servingCount:servingCount??(calculated.serving&&calculated.serving.grams>0?Math.round((calculated.grams/calculated.serving.grams)*100)/100:null),calculated:calculated.nutrition,saved:{calories:data.calories,proteinG:data.proteinG,carbsG:data.carbsG,fatG:data.fatG,fiberG:data.fiberG},nutrientUnknowns:require('../services/nutrientCompleteness').computeUnknowns(calculated.nutrition,{calories:data.calories,proteinG:data.proteinG,carbsG:data.carbsG,fatG:data.fatG,fiberG:data.fiberG}),userEdited:edited,loggedSource:edited?'user-entered correction':'catalog calculation'};
  } else data.nutritionSnapshot={loggedSource:'user-entered or external estimate',grams:data.quantityG,nutrientUnknowns:data.fiberG==null?['fiberG']:[]};
  // Explicitly grouped meal components (pc-HUM-207): one top-level component
  // per explicitly entered food — a mixed dish is ONE component, never
  // decomposed. Only allowlisted fields persist (foodName, amountG); unknown
  // weight is honest null. Nothing is inferred — no ingredients, no weights,
  // no provenance — and arbitrary snapshot fields are never accepted here.
  if(b.components!=null){
   if(!Array.isArray(b.components)||!b.components.length)throw httpError(400,'components must be a non-empty array when provided');
   if(b.components.length>20)throw httpError(400,'components limited to 20 per meal');
   data.nutritionSnapshot.components=b.components.map((c,i)=>{
    if(!c||typeof c!=='object'||Array.isArray(c))throw httpError(400,`components[${i}] must be an object`);
    if(typeof c.foodName!=='string'||!c.foodName.trim())throw httpError(400,`components[${i}].foodName required`);
    if(c.foodName.length>300)throw httpError(400,`components[${i}].foodName too long`);
    const out={foodName:c.foodName.trim()};
    if(c.amountG==null){out.amountG=null;}
    else if(!Number.isFinite(c.amountG)||c.amountG<=0||c.amountG>20000)throw httpError(400,`components[${i}].amountG must be within 0–20000 g or null for unknown weight`);
    else out.amountG=c.amountG;
    return out;
   });
  }
  if(b.nutritionProfileId&&b.ingredientId){
   if(typeof b.nutritionProfileId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.nutritionProfileId))throw httpError(400,'Invalid nutrition profile');
   data.nutritionSnapshot.nutritionProfileId=b.nutritionProfileId;
  }
  try {
   // K08: possible-duplicate detection across logging channels. Detection is
   // advisory only — the log is still written (legitimate repeated meals are
   // never removed); the client sees duplicateWarning and can confirm/merge.
   const prior=await prisma.foodLog.findFirst({where:{userId,loggedAt:{gte:new Date(loggedAt.getTime()-30*60000),lte:new Date(loggedAt.getTime()+30*60000)}},select:{id:true,foodName:true,loggedAt:true,nutritionSnapshot:true}}).catch(()=>null);
   const dup=prior?require('../services/scenarioCapabilities').detectDuplicateLog({a:{fdcId:prior.nutritionSnapshot?.fdcId||prior.nutritionSnapshot?.sourceRecordKey,foodName:prior.foodName,loggedAt:prior.loggedAt},b:{fdcId:b.fdcId||b.sourceRecordKey,foodName:data.foodName,loggedAt}}):{possibleDuplicate:false};
   if(dup.possibleDuplicate)data.nutritionSnapshot.possibleDuplicateOf={foodLogId:prior.id,basis:dup.basis,needsConfirmation:dup.needsConfirmation};
   const saved=await prisma.foodLog.create({data:{id:b.id,userId,...data,loggedAt}});
   const foodIntelligence=await intelligence.safe(()=>intelligence.ingredient({ingredientId:data.ingredientId,profileId:data.nutritionSnapshot.nutritionProfileId,grams:data.quantityG},userId,prisma),data.ingredientId);
   res.status(201).json({...saved,foodIntelligence,duplicateWarning:dup.possibleDuplicate?{possibleDuplicate:true,basis:dup.basis,existingId:prior.id,needsConfirmation:true,note:'A similar entry was logged within 30 minutes — kept both; confirm if this is a duplicate.'}:null});
  }
  catch(e){if(e.code!=='P2002')throw e;const log=await prisma.foodLog.findUnique({where:{id:b.id}});if(log?.userId!==userId)throw httpError(409,'Meal id conflict');res.json(log);}
 }catch(e){next(e);}
});
router.get('/',async(req,res,next)=>{
 try {
  const userId=req.userId || req.headers['x-user-id'];
  const date=req.query.date || new Date().toISOString().slice(0,10);
  if(typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))throw httpError(400,'Invalid date');
  const start=new Date(`${date}T00:00:00.000Z`);if(!Number.isFinite(start.getTime()) || start.toISOString().slice(0,10) !== date)throw httpError(400,'Invalid date');
  res.json({logs:await getPrisma().foodLog.findMany({where:{userId,loggedAt:{gte:start,lt:new Date(start.getTime()+86400000)}},orderBy:{loggedAt:'desc'}})});
 }catch(e){next(e);}
});
router.delete('/:id',async(req,res,next)=>{
 try { await getPrisma().foodLog.deleteMany({where:{id:req.params.id,userId:req.userId || req.headers['x-user-id']}});res.json({ok:true}); }catch(e){next(e);}
});
module.exports=router;
