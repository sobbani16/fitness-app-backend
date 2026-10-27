const express = require('express');
const { searchRecipes, getRecipeNutrition } = require('../services/recipeService');

const router = express.Router();
router.get('/:id/intelligence',async(req,res,next)=>{try{
 const db=require('../lib/prisma').getPrisma(), userId=req.userId||req.headers['x-user-id'];
 const recipe=await db.recipe.findFirst({where:{id:req.params.id,OR:[{isSystem:true},{creatorId:userId}]},include:{ingredients:true}});
 if(!recipe)return res.status(404).json({error:'Recipe unavailable'});
 const grams=req.query.grams==null?undefined:Number(req.query.grams);
 if(grams!=null&&(!Number.isFinite(grams)||grams<=0||grams>100000))return res.status(400).json({error:'Invalid portion'});
 const service=require('../services/nutrients/foodIntelligence');
 res.json(await service.safe(async()=>(await service.recipes([recipe],userId,db,grams))[0],recipe.id));
}catch(e){next(e);}});

// GET /recipes/search?q=chicken
// Returns autosuggest results: [{ id, title, image }]
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').toString();
    const results = await searchRecipes(q, req.userId);
    res.json({ results });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /recipes/:id/nutrition
// Returns macros + per-100g values so the client can re-scale by portion.
router.get('/:id/nutrition', async (req, res) => {
  try {
    const nutrition = await getRecipeNutrition(req.params.id, req.userId);
    res.json(nutrition);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// User-authored recipes retain a calculation snapshot; later catalog imports never rewrite them.
router.post('/',async(req,res,next)=>{try{
 const b=req.body||{};if(typeof b.name!=='string'||!b.name.trim()||b.name.length>200)return res.status(400).json({error:'Recipe name required'});
 const calc=await require('../services/ingredientNutrition').calculateRecipe(b.ingredients,b.yieldGrams);
 const recipe=await require('../lib/prisma').getPrisma().recipe.create({data:{creatorId:req.userId,recipeName:b.name,servings:1,portionG:calc.yieldGrams,...Object.fromEntries(['calories','proteinG','carbsG','fatG','fiberG'].map(k=>[k,calc.totals[k]])),nutritionSource:{source:'central-ingredient-catalog',...calc},ingredients:{create:calc.ingredients.map(i=>({ingredientId:i.ingredientId,ingredientName:i.name,amountG:i.grams,nutritionSnapshot:i}))}}});res.status(201).json(recipe);
}catch(e){next(e);}});
module.exports = router;
