const { httpError } = require('../../lib/errors');
const { attributable } = require('./catalog');
const DIETS = ['vegetarian','vegan','dairy-free','egg-free','soy-free','gluten-free','nut-free','peanut-free','fish-free','shellfish-free'];
const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const enums = { planGenerationDay: DAYS, shoppingDay: DAYS, mealPrepStyle:['daily_cooking','weekly_prep','twice_weekly_prep'], budgetLevel:['low','medium','high'], cookingSkill:['beginner','intermediate','advanced'] };
function validatePreferences(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400,'Invalid preferences.');
  const allowed = [...Object.keys(enums),'planGenerationTime','shoppingTime','householdSize','availableEquipment','dietaryRestrictions'];
  if (Object.keys(body).some(k=>!allowed.includes(k))) throw httpError(400,'Unknown preference field.');
  const data = { ...body };
  for (const [key, values] of Object.entries(enums)) if (key in data && !(key==='shoppingDay' && data[key]===null) && !values.includes(data[key])) throw httpError(400,`Invalid ${key}.`);
  for (const key of ['planGenerationTime','shoppingTime']) if (key in data && !(key==='shoppingTime' && data[key]===null) && (typeof data[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data[key]))) throw httpError(400,`Invalid ${key}.`);
  if ('householdSize' in data && (!Number.isInteger(data.householdSize) || data.householdSize<1 || data.householdSize>12)) throw httpError(400,'Household size must be 1–12.');
  for (const key of ['availableEquipment','dietaryRestrictions']) if (key in data) {
    if (!Array.isArray(data[key]) || data[key].length>30 || data[key].some(x=>typeof x !== 'string' || !x.trim() || x.length>80)) throw httpError(400,`Invalid ${key}.`);
    data[key] = [...new Set(data[key].map(x=>x.trim().toLowerCase()))];
  }
  if (data.availableEquipment?.some(x=>!['stovetop','microwave','oven','blender','refrigerator'].includes(x))) throw httpError(400,'Unsupported equipment.');
  if (data.dietaryRestrictions?.some(x=>!DIETS.includes(x) && !/^exclude:[a-z][a-z -]{1,60}$/.test(x))) throw httpError(400,'Choose a supported dietary filter or exclude:ingredient.');
  return data;
}
function recipeAllowed(recipe, disliked = [], restrictions = [], prefs = {}) {
  if (!attributable(recipe)) return false;
  const text = [recipe.recipeName, ...recipe.ingredients.map(i=>i.ingredientName)].join(' ').toLowerCase();
  if ([...disliked].some(d=>text.includes(d.toLowerCase()))) return false;
  const tags = recipe.nutritionSource.tags;
  const banned = { vegetarian:['meat','fish','shellfish'], vegan:['animal'], 'dairy-free':['milk'], 'egg-free':['egg'], 'soy-free':['soy'], 'gluten-free':['gluten'], 'nut-free':['nuts'], 'peanut-free':['peanuts'], 'fish-free':['fish'], 'shellfish-free':['shellfish'] };
  for (const r of restrictions) {
    if (r.startsWith('exclude:')) { if (text.includes(r.slice(8).trim())) return false; }
    else if (banned[r]) { if (banned[r].some(t=>tags.includes(t))) return false; }
    else return false; // Unknown saved restrictions must never be silently ignored.
  }
  if (prefs.budgetLevel==='low' && recipe.nutritionSource.budget!=='low') return false;
  const equipment = recipe.nutritionSource.equipment;
  if (prefs.availableEquipment?.length && equipment.length && !equipment.some(e=>prefs.availableEquipment.includes(e))) return false;
  return true;
}
function validateTargets(ctx) {
  const bounds = { caloriesTarget:[800,6000], proteinTarget:[1,500], carbsTarget:[1,1000], fatTarget:[1,300], fiberTarget:[1,100] };
  for (const [key,[min,max]] of Object.entries(bounds)) if (!Number.isFinite(ctx[key]) || ctx[key]<min || ctx[key]>max) throw httpError(422,`Saved ${key} is outside the planner's supported range. Review your targets.`);
  const energy = ctx.proteinTarget*4 + ctx.carbsTarget*4 + ctx.fatTarget*9;
  if (Math.abs(energy-ctx.caloriesTarget)>ctx.caloriesTarget*0.25) throw httpError(422,'Macro targets are inconsistent with the calorie target. Review your targets.');
}
function assessMeals(meals, targets) {
  return Array.from({length:7},(_,dayOfWeek)=> {
    const day = meals.filter(m=>m.dayOfWeek===dayOfWeek);
    const totals = Object.fromEntries(['calories','proteinG','carbsG','fatG','fiberG'].map(k=>[k,Math.round(day.reduce((sum,m)=>sum+m[k],0)*10)/10]));
    const deviations = Object.fromEntries(Object.entries({ calories:'caloriesTarget',proteinG:'proteinTarget',carbsG:'carbsTarget',fatG:'fatTarget',fiberG:'fiberTarget' }).map(([k,t])=>[k,Math.round((totals[k]-targets[t])/targets[t]*100)]));
    const warnings = Object.keys(deviations).filter(k=>k==='fiberG' ? deviations[k]<-10 : Math.abs(deviations[k])>(k==='calories'?10:20));
    return {dayOfWeek,totals,deviations,warnings};
  });
}
module.exports = { validatePreferences, recipeAllowed, validateTargets, assessMeals, DIETS };
