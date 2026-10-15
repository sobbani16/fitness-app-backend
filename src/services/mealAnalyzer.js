const { detectFood }=require('./foodDetector');
async function analyzeMeal(input) {
 const d=await detectFood(input),factor=d.suggestedPortionGrams/100;
 return {...d,name:d.foodName,calories:d.estimatedCalories,macros:Object.fromEntries(Object.entries(d.macrosPer100g).map(([k,v])=>[k,Math.round(v*factor*10)/10])),feedback:'Estimated nutrition. Review the food and portion before saving.',source:d.source,hasPhoto:d.hasPhoto};
}
module.exports={analyzeMeal};
