const express = require('express');
const { searchIngredients } = require('../services/ingredientService');

const router = express.Router();

function getUserId(req) {
  return (req.headers['x-user-id'] || req.query.userId || '').toString().trim();
}

// GET /ingredients/search?q=chicken   (header: x-user-id)
// Three-tier lookup: user table -> central table -> USDA (cached into both).
// Returns: { results: [{ id, fdcId, name, caloriesPer100g, macrosPer100g, source }] }
router.get('/search', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header or userId required' });
    }
    const query = req.query.q ?? req.query.query ?? '';
    if (typeof query !== 'string') return res.status(400).json({ error: 'q must be a single string' });
    if (!query.trim()) {
      return res.status(400).json({ error: 'q (query) is required' });
    }
    for (const key of ['preparation','productType','verificationLevel']) if(req.query[key] != null && (typeof req.query[key] !== 'string' || req.query[key].length > 100)) return res.status(400).json({error:'Invalid filter'});
    if(req.query.productType && !['generic','branded'].includes(req.query.productType))return res.status(400).json({error:'Invalid product type'});
    if(req.query.verificationLevel && !require('../services/ingredientCsv').levels.includes(req.query.verificationLevel))return res.status(400).json({error:'Invalid verification level'});
    const results = await searchIngredients({ userId, query, preparation: req.query.preparation, productType: req.query.productType, verificationLevel: req.query.verificationLevel });
    res.json({ results });
  } catch (err) {
    const status = err.message && /required/i.test(err.message) ? 400 : 500;
    res.status(err.status || status).json({ error: err.message });
  }
});

const {getPrisma}=require('../lib/prisma');
const central=require('../services/ingredientNutrition');
router.get('/selections',async(req,res,next)=>{try{
 const rows=await getPrisma().userIngredient.findMany({where:{userId:getUserId(req),...(req.query.favorite==='true'?{favorite:true}:{selectedAt:{not:null}})},include:{ingredient:{include:{catalog:true,servings:true}}},orderBy:{selectedAt:'desc'},take:30});
 res.json({results:rows.filter(x=>!x.ingredient.catalog||x.ingredient.catalog.usable).map(x=>({...require('../services/ingredientService').toDto(x.ingredient,x.ingredient.source),favorite:x.favorite}))});
}catch(e){next(e);}});
router.post('/recipe-nutrition',async(req,res,next)=>{try{res.json(await central.calculateRecipe(req.body.ingredients,req.body.yieldGrams));}catch(e){next(e);}});
router.get('/:id',async(req,res,next)=>{try{const i=await central.getIngredient(req.params.id);res.json(require('../services/ingredientService').toDto(i,i.source));}catch(e){next(e);}});
router.post('/:id/nutrition',async(req,res,next)=>{try{res.json(await central.calculate(req.params.id,req.body));}catch(e){next(e);}});
router.put('/:id/selection',async(req,res,next)=>{try{
 await central.getIngredient(req.params.id);if(req.body.favorite!=null && typeof req.body.favorite!=='boolean')return res.status(400).json({error:'favorite must be boolean'});
 const userId=getUserId(req),ingredientId=req.params.id;
 const data={selectedAt:new Date(),...(req.body.favorite==null?{}:{favorite:req.body.favorite})};
 await getPrisma().userIngredient.upsert({where:{userId_ingredientId:{userId,ingredientId}},create:{userId,ingredientId,...data},update:data});res.json({ok:true});
}catch(e){next(e);}});
module.exports = router;
