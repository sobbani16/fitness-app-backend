const { httpError } = require('../lib/errors');
let _fetch=globalThis.fetch;
const setFetch=fn=>{_fetch=fn;};
const getApiKey=()=>process.env.USDA_API_KEY||'DEMO_KEY';
const usingDemoKey=()=>!process.env.USDA_API_KEY;
function nutrient(food,names,unit){const n=(food.foodNutrients||[]).find(x=>names.includes((x.nutrientName||'').toLowerCase())&&(!unit||(x.unitName||'').toUpperCase()===unit));return n && n.value!=null && Number.isFinite(Number(n.value)) && Number(n.value)>=0?Number(n.value):null;}
function mapFood(f){
 const kcal=nutrient(f,['energy'],'KCAL'),kj=nutrient(f,['energy'],'KJ');
 return {fdcId:String(f.fdcId),name:f.description||'Food',caloriesPer100g:kcal??(kj==null?null:kj/4.184),proteinPer100g:nutrient(f,['protein']),carbsPer100g:nutrient(f,['carbohydrate, by difference']),fatPer100g:nutrient(f,['total lipid (fat)']),fiberPer100g:nutrient(f,['fiber, total dietary']),source:'usda',sourceMetadata:{provider:'USDA FoodData Central',fdcId:String(f.fdcId),dataType:f.dataType||null,brand:f.brandOwner||f.brandName||null,servingSize:f.servingSize??null,servingSizeUnit:f.servingSizeUnit||null,householdServingFullText:f.householdServingFullText||null,retrievedAt:new Date().toISOString(),carb_definition:'total carbohydrate (USDA carbohydrate by difference)',nutrients:f.foodNutrients||[]}};
}
async function searchUsda(query,number=8){
 if(!query?.trim())return[];
 let res;
 for(let attempt=0;attempt<2;attempt++){
  try{res=await _fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(getApiKey())}`,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify({query:query.trim(),pageSize:number,dataType:['Foundation','SR Legacy','Survey (FNDDS)','Branded']})});}
  catch{res=null;}
  if(res?.ok)break;
  if(res && res.status!==429 && res.status<500)break;
  if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!res?.ok)throw httpError(503,'Food search service unavailable. Please retry.');
 let data;try{data=await res.json();}catch{throw httpError(503,'Food search service unavailable. Please retry.');}
 return (Array.isArray(data.foods)?data.foods:[]).map(mapFood).filter(x=>['caloriesPer100g','proteinPer100g','carbsPer100g','fatPer100g'].every(k=>x[k]!=null));
}
// GET /fdc/v1/food/{fdcId} — detail incl. foodPortions (verified household
// measures: measureUnit name, portionDescription, gramWeight, sequenceNumber).
async function getUsdaFood(fdcId){
 let res;
 for(let attempt=0;attempt<2;attempt++){
  try{res=await _fetch(`https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(getApiKey())}`,{signal:AbortSignal.timeout(8000)});}
  catch{res=null;}
  if(res?.ok)break;
  if(res && res.status!==429 && res.status<500)break;
  if(attempt===0)await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!res?.ok)throw httpError(res?.status===404?404:503,res?.status===404?'USDA food not found':'USDA detail service unavailable.');
 const f=await res.json();
 return {fdcId:String(f.fdcId),description:f.description||'',dataType:f.dataType||null,brandOwner:f.brandOwner||null,householdServingFullText:f.householdServingFullText||null,servingSize:f.servingSize??null,servingSizeUnit:f.servingSizeUnit||null,foodPortions:Array.isArray(f.foodPortions)?f.foodPortions.map(p=>({id:p.id??null,amount:p.amount??null,portionDescription:p.portionDescription||null,modifier:p.modifier||null,measureUnit:p.measureUnit?{id:p.measureUnit.id,name:p.measureUnit.name,abbreviation:p.measureUnit.abbreviation}:null,gramWeight:Number.isFinite(p.gramWeight)?p.gramWeight:null,sequenceNumber:p.sequenceNumber??null})).filter(p=>p.gramWeight>0):[]};
}
module.exports={searchUsda,getUsdaFood,setFetch,getApiKey,usingDemoKey,mapFood};
