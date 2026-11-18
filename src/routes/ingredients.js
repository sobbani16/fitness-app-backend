const express = require('express');
const router = express.Router();
const { searchIngredients } = require('../services/ingredientService');
const { requireFeature } = require('../middleware/requireFeature');
const { askJSON } = require('../services/aiProvider');
const { httpError } = require('../lib/errors');
const ESTIMATE_VERSION = 1;

// POST /ingredients/estimate — opt-in AI nutrition estimate when the catalog has
// no good match. Flag-gated, quota'd via askJSON, never writes to any catalog —
// the response is for user review only (provenance: ai_estimate, unreviewed).
router.post('/estimate', requireFeature('ai_food_estimation_enabled'), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) throw httpError(401, 'Sign in required.');
    const { query, portion, preparation } = req.body || {};
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200) throw httpError(400, 'query must be 2–200 characters.');
    for (const v of [portion, preparation]) if (v != null && (typeof v !== 'string' || v.length > 200)) throw httpError(400, 'portion/preparation must be ≤200 characters.');
    const hints = [portion && `portion: ${portion}`, preparation && `preparation: ${preparation}`].filter(Boolean).join('; ');
    const out = await askJSON('food_estimate', {
      dishName: { type: 'string' }, servingDescription: { type: 'string' },
      calories: { type: 'number' }, proteinG: { type: 'number' }, carbsG: { type: 'number' }, fatG: { type: 'number' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      assumptions: { type: 'array', items: { type: 'string' } },
      needsClarification: { type: 'array', items: { type: 'string' } },
    },
      'Estimate typical nutrition for ONE serving of the named dish. Use typical homemade composition; if the dish is ambiguous (regional variants, unknown oil/portion), set confidence low and list clarifying questions. Numbers are per serving in servingDescription. Never claim exactness.',
      `Dish: ${query.trim()}${hints ? ` (${hints})` : ''}`, null, userId, { maxOutputTokens: 800 });
    res.json({ estimate: {
      name: String(out.dishName || query).slice(0, 120),
      serving: String(out.servingDescription || '1 serving').slice(0, 120),
      calories: Math.max(0, Math.round(Number(out.calories) || 0)),
      proteinG: Math.max(0, Math.round(Number(out.proteinG) * 10) / 10),
      carbsG: Math.max(0, Math.round(Number(out.carbsG) * 10) / 10),
      fatG: Math.max(0, Math.round(Number(out.fatG) * 10) / 10),
      confidence: ['low', 'medium', 'high'].includes(out.confidence) ? out.confidence : 'low',
      assumptions: Array.isArray(out.assumptions) ? out.assumptions.slice(0, 8).map(a => String(a).slice(0, 200)) : [],
      needsClarification: Array.isArray(out.needsClarification) ? out.needsClarification.slice(0, 5).map(a => String(a).slice(0, 200)) : [],
      provenance: { source: 'ai_estimate', version: ESTIMATE_VERSION, reviewed: false },
    } });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

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
    const code = (err.status || status) >= 500 ? 'food-search-unavailable' : 'bad-request';
    res.status(err.status || status).json({ error: err.message, code, retryable: (err.status || status) >= 500 });
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
// POST /ingredients/estimate/log — persist a REVIEWED estimate as a FoodLog
// row. No shared catalog write: ingredientId stays null; provenance + the
// user's corrections live in nutritionSnapshot. Client-supplied id makes
// retried saves idempotent (P2002 -> return existing row).
router.post('/estimate/log', requireFeature('ai_food_estimation_enabled'), async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) throw httpError(401, 'Sign in required.');
    const b = req.body || {};
    const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
    if (typeof b.name !== 'string' || !b.name.trim()) throw httpError(400, 'name is required.');
    if (b.id != null && (typeof b.id !== 'string' || b.id.length > 64)) throw httpError(400, 'id must be ≤64 chars.');
    if (!['breakfast','lunch','dinner','snack'].includes(b.mealType)) throw httpError(400, 'mealType must be breakfast|lunch|dinner|snack.');
    const est = (b.estimate && typeof b.estimate === 'object') ? b.estimate : {};
    const data = {
      userId, foodName: b.name.trim().slice(0, 200),
      quantityG: num(b.portionG, 20000), calories: num(b.calories, 15000),
      proteinG: num(b.proteinG, 2000), carbsG: num(b.carbsG, 2000), fatG: num(b.fatG, 2000), fiberG: num(b.fiberG, 500),
      mealType: b.mealType,
      nutritionSnapshot: {
        provenance: 'ai_estimate', estimateVersion: ESTIMATE_VERSION, reviewed: true,
        serving: String(est.serving || '').slice(0, 120), confidence: est.confidence || 'low',
        assumptions: Array.isArray(est.assumptions) ? est.assumptions.slice(0, 8) : [],
        userCorrections: b.userCorrections === true,
      },
    };
    const prisma = getPrisma();
    try {
      const log = await prisma.foodLog.create({ data: { ...(b.id ? { id: b.id } : {}), ...data } });
      res.status(201).json({ foodLog: log });
    } catch (e) {
      if (e.code === 'P2002' && b.id) {
        const log = await prisma.foodLog.findUnique({ where: { id: b.id } });
        if (log?.userId !== userId) throw httpError(409, 'Log id conflict.');
        res.json({ foodLog: log }); return;
      }
      throw e;
    }
  } catch (e) { next(e); }
});

module.exports = router;
