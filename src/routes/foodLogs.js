const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
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
  try { res.status(201).json(await prisma.foodLog.create({data:{id:b.id,userId,...data,loggedAt}})); }
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
