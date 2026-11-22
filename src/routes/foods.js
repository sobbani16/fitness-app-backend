const express = require('express');
const router = express.Router();
const { searchFoods } = require('../services/foodSearch');
const { matchRecipes } = require('../services/recipeMatch');
const { httpError } = require('../lib/errors');

const uid = (req) => (req.userId || req.headers['x-user-id'] || '').toString().trim();

// GET /foods/search?q=gongura&type=recipe|cuisine=Indian|mealType=lunch|verificationLevel=…
// Unified ingredients + recipes ranking; recipe results carry per-serving macros.
router.get('/search', async (req, res, next) => {
  try {
    const filters = {};
    for (const k of ['type', 'cuisine', 'region', 'mealType', 'preparation', 'productType', 'verificationLevel']) {
      const v = req.query[k];
      if (v != null) {
        if (typeof v !== 'string' || v.length > 100) throw httpError(400, `Invalid filter ${k}`);
        filters[k] = v;
      }
    }
    if (filters.type && !['ingredient', 'recipe'].includes(filters.type)) throw httpError(400, 'type must be ingredient|recipe');
    if (filters.mealType && !['breakfast', 'lunch', 'dinner', 'snack'].includes(filters.mealType)) throw httpError(400, 'Invalid mealType');
    if (req.query.own === 'true') filters.own = true;
    const limit = req.query.limit == null ? 20 : Number(req.query.limit);
    res.json(await searchFoods({ userId: uid(req), query: req.query.q ?? '', limit, filters }));
  } catch (e) { next(e); }
});

// POST /recipes/match { ingredients: ["chicken","rice","onion"] }
// Relational matching on linked ingredientIds; returns missing lines + coverage.
router.post('/match', async (req, res, next) => {
  try {
    res.json(await matchRecipes({ userId: uid(req), ingredients: req.body?.ingredients, limit: req.body?.limit }));
  } catch (e) { next(e); }
});

module.exports = router;
