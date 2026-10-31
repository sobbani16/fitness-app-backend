const { getPrisma } = require('../../lib/prisma');
const { httpError } = require('../../lib/errors');
const { nutrients, version } = require('./catalog');
const { recipeAllowed, validateTargets, validatePreferences, assessMeals, preferredCuisines } = require('./planningPolicy');
const { generateAiWeeklyMeals } = require('./aiWeeklyGenerator');
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
  const prisma = getPrisma();
  // Planning inputs load before the transaction — the AI draft is a slow
  // network call that must not hold the user row lock.
  const saved0 = await prisma.macroGoal.findUnique({where:{userId}});
  if (!saved0) throw httpError(422,'Complete your profile and save nutrition targets before generating a plan.');
  // Targets are server-owned. Clients cannot silently replace saved/custom goals.
  for (const key of ['caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget']) if (requested[key]!==undefined && requested[key]!==saved0[key]) throw httpError(409,'Requested targets differ from saved goals. Refresh your profile before planning.');
  const ctx = Object.fromEntries(['caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget'].map(k=>[k,saved0[k]]));
  validateTargets(ctx);
  const preferences = await prisma.userPlanningPreferences.findUnique({where:{userId}});
  if (preferences) validatePreferences(Object.fromEntries(['mealPrepStyle','budgetLevel','cookingSkill','householdSize','availableEquipment','dietaryRestrictions'].map(k=>[k,preferences[k]])));
  const prefs = await prisma.foodPreference.findMany({where:{userId}});
  const restrictions = preferences?.dietaryRestrictions||[];
  const allergies = (await prisma.userAllergy.findMany({where:{userId},include:{allergy:true}})).map(a=>a.allergy.name).filter(Boolean);
  // Active health conditions drive the deterministic safety layer: ingredient
  // attribute rules (block/warn) and APPROVED nutrient rules are enforced on
  // every proposed meal, for both AI drafts and the catalog fallback.
  const userConditions = await prisma.userHealthCondition.findMany({where:{userId,active:true},include:{condition:{include:{
    conditionRules:{where:{target:'ingredient'}},
    nutrientRules:{where:{reviewStatus:'APPROVED'},include:{nutrient:true}}}}}});
  const conditionRules = userConditions.flatMap(uc=>uc.condition.conditionRules.map(r=>({attribute:r.attribute,action:r.action,reason:r.reason,conditionName:uc.condition.name})));
  const nutrientRules = userConditions.flatMap(uc=>uc.condition.nutrientRules.map(r=>({action:r.action,severity:r.severity,thresholdValue:Number(r.thresholdValue),thresholdUnit:r.thresholdUnit,thresholdBasis:r.thresholdBasis,conditionName:uc.condition.name,nutrient:r.nutrient})));
  const blockAttrs = new Set(conditionRules.filter(r=>r.action==='block').map(r=>r.attribute));
  const blockedIngredientIds = blockAttrs.size
    ? new Set((await prisma.ingredientAttribute.findMany({where:{attribute:{in:[...blockAttrs]}},select:{ingredientId:true}})).map(r=>r.ingredientId))
    : new Set();
  // Resolve free-text ingredient names to verified catalog entries (exact
  // normalized match, then shortest contains match). Unresolvable names stay
  // absent — the caller treats absence as "cannot verify", never "safe".
  async function resolveIngredients(names) {
    const exact = await prisma.ingredient.findMany({where:{normalizedName:{in:names}},include:{attributes:true}});
    const map = new Map(exact.map(i=>[i.normalizedName,{id:i.id,attributes:i.attributes.map(a=>a.attribute)}]));
    for (const n of names.filter(n=>!map.has(n)).slice(0,60)) {
      const hits = await prisma.ingredient.findMany({where:{normalizedName:{contains:n}},include:{attributes:true},take:5,orderBy:{normalizedName:'asc'}});
      if (hits.length) { hits.sort((a,b)=>a.normalizedName.length-b.normalizedName.length); map.set(n,{id:hits[0].id,attributes:hits[0].attributes.map(a=>a.attribute)}); }
    }
    return map;
  }
  const mealCtx = {...ctx, preferences:preferences||{},
    dislikedFoods:prefs.filter(p=>['DISLIKE','NEVER_RECOMMEND'].includes(p.preference)).map(p=>p.foodName),
    likedFoods:prefs.filter(p=>['LOVE','LIKE'].includes(p.preference)).map(p=>p.foodName),
    restrictions, mealPrepStyle:preferences?.mealPrepStyle||'daily_cooking',
    conditionRules, nutrientRules, resolveIngredients};

  // AI proposes first (dishes + ingredient grams + estimated macros); the
  // deterministic catalog is the fallback when AI is off or fails. Either
  // way, safety filters and day-level assessment stay deterministic.
  let aiMeals = null, aiMeta = null;
  if (require('../aiProvider').aiEnabled() && process.env.OPENAI_API_KEY?.trim()) {
    try {
      const ai = await generateAiWeeklyMeals({ ...mealCtx, userId, allergies,
        cuisines: preferredCuisines(restrictions), fiberTarget: ctx.fiberTarget,
        equipment: preferences?.availableEquipment || [] });
      aiMeals = ai.meals; aiMeta = ai.meta;
    } catch (e) {
      if (e.status === 429) throw httpError(429,'Daily AI usage limit reached. Try again tomorrow or use manual entry.');
      aiMeta = { dropped: [], notes: [`AI generation unavailable${e.status?` (${e.message})`:''}; used the verified catalog instead.`] };
    }
  }

  return prisma.$transaction(async tx=> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    const existing = await tx.weeklyNutritionPlan.findUnique({where:{userId_weekStartDate:{userId,weekStartDate}},include:{meals:true}});
    if (existing?.meals.some(m=>m.confirmedByUser)) throw httpError(409,'This week contains confirmed meals. Unconfirm through the supported flow before regenerating.');
    const saved = await tx.macroGoal.findUnique({where:{userId}});
    // Re-verify inside the lock: goals may have changed during the AI call.
    if (!saved) throw httpError(422,'Complete your profile and save nutrition targets before generating a plan.');
    for (const key of ['caloriesTarget','proteinTarget','carbsTarget','fatTarget','fiberTarget']) if (saved[key]!==ctx[key]) throw httpError(409,'Your saved goals changed while the plan was being generated. Review them and try again.');
    let allRecipes = await require('./centralRecipes').resolveRecipes(await tx.recipe.findMany({where:{isSystem:true},include:{ingredients:true}}),tx);
    if (blockAttrs.size) allRecipes = allRecipes.filter(r=>r.ingredients.every(i=>i.ingredientId && !blockedIngredientIds.has(i.ingredientId)));
    const recipesByType = Object.fromEntries(['breakfast','lunch','dinner','snack'].map(t=>[t,allRecipes.filter(r=>r.mealType===t)]));
    let meals = aiMeals, source = aiMeals ? 'ai_generated' : 'usda_catalog';
    if (!meals) meals = generateWeeklyMeals({...mealCtx, recipesByType});
    const dayAssessment = aiMeta?.dayAssessment || assessMeals(meals,ctx);
    const details = {catalogVersion:version,source,targetSource:saved.source,householdSize:preferences?.householdSize||1,
      preferences:preferences ? Object.fromEntries(['mealPrepStyle','budgetLevel','cookingSkill','householdSize','availableEquipment','dietaryRestrictions'].map(k=>[k,preferences[k]])) : {},
      days:dayAssessment,
      ...(conditionRules.length || nutrientRules.length ? { conditions: {
        ingredientRulesApplied: conditionRules.length, nutrientRulesApplied: nutrientRules.length,
        mealWarnings: aiMeta?.mealWarnings || [], unverified: (aiMeta?.notes || []).filter(n => n.includes('cannot be verified')) } } : {}),
      ...(aiMeta ? { ai: { dropped: aiMeta.dropped, notes: aiMeta.notes,
        ingredients: meals.filter(m=>m.ingredients?.length).map(m=>({dayOfWeek:m.dayOfWeek,mealType:m.mealType,ingredients:m.ingredients})) } } : {})};
    const explanation = source === 'ai_generated' && aiMeta?.dayAssessment
      ? 'Dishes suggested by AI and checked against your saved dietary filters and active health-condition rules before being shown. Calories and macros are AI estimates, not lab data; ingredient filters cannot guarantee allergen-free preparation.'
      : 'Calculated estimates from USDA ingredients. Targets apply per person; household size scales the shopping list. Review nutrient gaps and preparation-state weights. Ingredient filters do not guarantee allergen-free preparation.';
    const data = {...ctx,status:'active',generationDetails:details,explanation};
    const plan = await tx.weeklyNutritionPlan.upsert({where:{userId_weekStartDate:{userId,weekStartDate}},create:{userId,weekStartDate,...data},update:data});
    await tx.weeklyMeal.deleteMany({where:{planId:plan.id}});
    await tx.weeklyShoppingList.deleteMany({where:{planId:plan.id}});
    await tx.weeklyReview.deleteMany({where:{planId:plan.id}});
    await tx.weeklyMeal.createMany({data:meals.map(m=>{ const { ingredients, ...row } = m; return { planId:plan.id, ...row }; })});
    await tx.notification.create({data:{userId,type:'plan_ready',title:'Your Weekly Plan Is Ready',body:`Review your plan for ${weekStartDate}, including nutrient gaps, before confirming.`}});
    return {planId:plan.id,weekStartDate,...ctx,mealsCount:meals.length,generationDetails:details};
  },{timeout:15000});
}
module.exports = { generateWeeklyMeals, generateWeeklyPlan, recipeToMeal };
