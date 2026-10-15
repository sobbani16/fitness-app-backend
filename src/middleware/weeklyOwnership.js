const { getPrisma } = require('../lib/prisma');
module.exports = async function(req,res,next) {
 try {
  const p=getPrisma(),userId=req.userId || req.headers['x-user-id'];
  let planId=req.body?.planId || req.query.planId;
  const mealMatch=/^\/meals\/([^/]+)/.exec(req.path);
  const itemMatch=/^\/shopping-list\/items\/([^/]+)/.exec(req.path);
  if(mealMatch){const meal=await p.weeklyMeal.findUnique({where:{id:mealMatch[1]}});if(!meal)return res.status(404).json({error:'Meal not found'});planId=meal.planId;}
  if(itemMatch){const item=await p.weeklyShoppingItem.findUnique({where:{id:itemMatch[1]},include:{shoppingList:true}});if(!item)return res.status(404).json({error:'Item not found'});planId=item.shoppingList.planId;}
  if(planId){
   const plan=await p.weeklyNutritionPlan.findUnique({where:{id:String(planId)}});
   if(!plan)return res.status(404).json({error:'Plan not found'});
   if(plan.userId!==userId){
    // Only assigned trainer may unlock a client's day, never impersonate the client.
    const trainer=await p.trainerProfile.findUnique({where:{userId}});
    const relation=trainer && await p.trainerClient.findFirst({where:{trainerId:trainer.id,clientId:plan.userId,status:'active'}});
    if(!req.path.endsWith('/unconfirm')||!relation)return res.status(403).json({error:'Plan access denied'});
   }
  }
  next();
 }catch(e){next(e);}
};
