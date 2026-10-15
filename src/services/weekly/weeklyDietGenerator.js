const { getPrisma } = require('../../lib/prisma');
const { httpError } = require('../../lib/errors');
const { nutrients, version } = require('./catalog');
const { recipeAllowed, validateTargets, validatePreferences, assessMeals } = require('./planningPolicy');
function recipeToMeal(recipe, factor = 1) {
  return { recipeId:recipe.id, foodName:recipe.recipeName, portionG:Math.round(recipe.portionG*factor*10)/10,
    ...Object.fromEntries(nutrients.map(k=>[k,Math.round(recipe[k]*factor*10)/10])) };
}
function generateWeeklyMeals(ctx) {
  validateTargets(ctx);
  const meals = [], used = new Map();
  const shares = { breakfast:0.25, lunch:0.3, dinner:0.3, snack:0.15 };
  const pools = Object.fromEntries(Object.keys(shares).map(type=>[type,(ctx.recipesByType[type]||[]).filter(r=>recipeAllowed(r,ctx.dislikedFoods,ctx.restrictions,ctx.preferences))]));
  if (Object.values(pools).some(pool=>!pool.length)) throw httpError(422,'The sourced catalog cannot satisfy these ingredient/equipment/budget preferences for every meal. Adjust preferences or use a custom plan.');
  for (let day=0;day<7;day++) {
    for (const [type,share] of Object.entries(shares)) {
      const candidates = pools[type].map(recipe=> {
        const factor = Math.max(0.5,Math.min(2,ctx.caloriesTarget*share/recipe.calories));
        const meal = recipeToMeal(recipe,factor);
        const score = Math.abs(meal.calories-ctx.caloriesTarget*share)/(ctx.caloriesTarget*share)*4 +
          ['proteinG','carbsG','fatG','fiberG'].reduce((sum,k,i)=>sum+Math.abs(meal[k]-ctx[['proteinTarget','carbsTarget','fatTarget','fiberTarget'][i]]*share)/(ctx[['proteinTarget','carbsTarget','fatTarget','fiberTarget'][i]]*share),0) +
          (used.get(recipe.id)||0)*0.15 - ((ctx.likedFoods||[]).some(f=>recipe.recipeName.toLowerCase().includes(f.toLowerCase()))?0.2:0);
        return {recipe,meal,score};
      }).sort((a,b)=>a.score-b.score || a.recipe.id.localeCompare(b.recipe.id));
      const chosen = candidates[0];used.set(chosen.recipe.id,(used.get(chosen.recipe.id)||0)+1);
      meals.push({dayOfWeek:day,mealType:type,...chosen.meal,prepNote:ctx.mealPrepStyle==='daily_cooking'?'Prepare today': 'Batch prep preference; follow safe storage instructions for each ingredient.'});
    }
  }
  if (assessMeals(meals,ctx).some(d=>Math.abs(d.deviations.calories)>10)) throw httpError(422,'The catalog cannot fit this calorie target within 10% using supported portions. Use a custom plan.');
  return meals;
}
async function generateWeeklyPlan(userId, weekStartDate, requested = {}) {
  const date = new Date(`${weekStartDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate) || !Number.isFinite(+date) || date.toISOString().slice(0,10)!==weekStartDate || date.getUTCDay()!==1) throw httpError(400,'Choose a valid Monday for weekStartDate.');
  return getPrisma().$transaction(async tx=> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    const existing = await tx.weeklyNutritionPlan.findUnique({where:{userId_weekStartDate:{userId,weekStartDate}},include:{meals:true}});
    if (existing?.meals.some(m=>m.confirmedByUser)) throw httpError(409,'This week contains confirmed meals. Unconfirm through the supported flow before regenerating.');
    const saved = await tx.macroGoal.findUnique({where:{userId}});
    if (!saved) throw httpError(422,'Complete your profile and save nutrition targets before generating a plan.');
    // Targets are server-owned. Clients cannot silently replace saved/custom goals.
    for (const key of ['caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget']) if (requested[key]!==undefined && requested[key]!==saved[key]) throw httpError(409,'Requested targets differ from saved goals. Refresh your profile before planning.');
    const ctx = Object.fromEntries(['caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget'].map(k=>[k,saved[k]]));
    validateTargets(ctx);
    const preferences = await tx.userPlanningPreferences.findUnique({where:{userId}});
    if (preferences) validatePreferences(Object.fromEntries(['mealPrepStyle','budgetLevel','cookingSkill','householdSize','availableEquipment','dietaryRestrictions'].map(k=>[k,preferences[k]])));
    const prefs = await tx.foodPreference.findMany({where:{userId}});
    const allRecipes = await tx.recipe.findMany({where:{isSystem:true},include:{ingredients:true}});
    const recipesByType = Object.fromEntries(['breakfast','lunch','dinner','snack'].map(t=>[t,allRecipes.filter(r=>r.mealType===t)]));
    const meals = generateWeeklyMeals({...ctx, recipesByType, preferences:preferences||{},
      dislikedFoods:prefs.filter(p=>['DISLIKE','NEVER_RECOMMEND'].includes(p.preference)).map(p=>p.foodName),
      likedFoods:prefs.filter(p=>['LOVE','LIKE'].includes(p.preference)).map(p=>p.foodName),
      restrictions:preferences?.dietaryRestrictions||[],mealPrepStyle:preferences?.mealPrepStyle||'daily_cooking'});
    const details = {catalogVersion:version,targetSource:saved.source,householdSize:preferences?.householdSize||1,preferences:preferences ? Object.fromEntries(['mealPrepStyle','budgetLevel','cookingSkill','householdSize','availableEquipment','dietaryRestrictions'].map(k=>[k,preferences[k]])) : {},days:assessMeals(meals,ctx)};
    const data = {...ctx,status:'active',generationDetails:details,explanation:'Calculated estimates from USDA ingredients. Targets apply per person; household size scales the shopping list. Review nutrient gaps and preparation-state weights. Ingredient filters do not guarantee allergen-free preparation.'};
    const plan = await tx.weeklyNutritionPlan.upsert({where:{userId_weekStartDate:{userId,weekStartDate}},create:{userId,weekStartDate,...data},update:data});
    await tx.weeklyMeal.deleteMany({where:{planId:plan.id}});
    await tx.weeklyShoppingList.deleteMany({where:{planId:plan.id}});
    await tx.weeklyReview.deleteMany({where:{planId:plan.id}});
    await tx.weeklyMeal.createMany({data:meals.map(m=>({planId:plan.id,...m}))});
    await tx.notification.create({data:{userId,type:'plan_ready',title:'Your Weekly Plan Is Ready',body:`Review your plan for ${weekStartDate}, including nutrient gaps, before confirming.`}});
    return {planId:plan.id,weekStartDate,...ctx,mealsCount:meals.length,generationDetails:details};
  },{timeout:15000});
}
module.exports = { generateWeeklyMeals, generateWeeklyPlan, recipeToMeal };
