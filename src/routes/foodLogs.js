const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const intelligence=require('../services/nutrients/foodIntelligence');
router.get('/profiles/:ingredientId',async(req,res,next)=>{try{res.json({profiles:await intelligence.profilesForIngredient(req.params.ingredientId)});}catch(e){next(e);}});
router.post('/intelligence',async(req,res,next)=>{try{
 const b=req.body||{};
 if(typeof b.ingredientId!=='string'||b.ingredientId.length>120||(b.profileId!=null&&(typeof b.profileId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.profileId))))throw httpError(400,'Invalid ingredient/profile');
 res.json(await intelligence.safe(()=>intelligence.ingredient({ingredientId:b.ingredientId,profileId:b.profileId,grams:b.grams},req.userId||req.headers['x-user-id']),b.ingredientId));
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
   const calculated=await require('../services/ingredientNutrition').calculate(b.ingredientId,{grams:data.quantityG});
   const edited=['calories','proteinG','carbsG','fatG','fiberG'].some(k=>data[k]!=null && (calculated.nutrition[k]==null || Math.abs(data[k]-calculated.nutrition[k])>(k==='calories'?0.51:0.051)));
   data.ingredientId=b.ingredientId;
   const catalogRevisionAtSelection=typeof b.catalogRevision==='string'?b.catalogRevision.slice(0,64):null;
   data.nutritionSnapshot={...calculated.provenance,catalogRevisionAtSelection,catalogChangedSinceSelection:!!catalogRevisionAtSelection && catalogRevisionAtSelection!==calculated.provenance.revision,grams:data.quantityG,loggedFoodName:data.foodName,selectedServing:b.selectedServing && typeof b.selectedServing==='string'?b.selectedServing.slice(0,200):null,calculated:calculated.nutrition,saved:{calories:data.calories,proteinG:data.proteinG,carbsG:data.carbsG,fatG:data.fatG,fiberG:data.fiberG},userEdited:edited,loggedSource:edited?'user-entered correction':'catalog calculation'};
  } else data.nutritionSnapshot={loggedSource:'user-entered or external estimate',grams:data.quantityG};
  if(b.nutritionProfileId&&b.ingredientId){
   if(typeof b.nutritionProfileId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.nutritionProfileId))throw httpError(400,'Invalid nutrition profile');
   data.nutritionSnapshot.nutritionProfileId=b.nutritionProfileId;
  }
  try {
   const saved=await prisma.foodLog.create({data:{id:b.id,userId,...data,loggedAt}});
   const foodIntelligence=await intelligence.safe(()=>intelligence.ingredient({ingredientId:data.ingredientId,profileId:data.nutritionSnapshot.nutritionProfileId,grams:data.quantityG},userId,prisma),data.ingredientId);
   res.status(201).json({...saved,foodIntelligence});
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
