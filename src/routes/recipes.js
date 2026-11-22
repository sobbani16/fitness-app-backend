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

// POST /recipes/match-ingredients — relational matching v2.
// {items:[{ingredientId|identityKey|name, amountG?}], diet:[], allergies:[],
//  cuisine, maxPrepMinutes, servings, limit}
router.post('/match-ingredients', async (req, res, next) => {
  try {
    const userId = req.userId || req.headers['x-user-id'];
    const b = req.body || {};
    const { matchIngredients } = require('../services/recipeMatch');
    const limit = b.limit == null ? 12 : Math.min(50, Math.max(1, Number(b.limit) || 12));
    res.json(await matchIngredients({
      userId,
      items: Array.isArray(b.items) ? b.items : null,
      ingredients: Array.isArray(b.ingredients) ? b.ingredients : null,
      diet: b.diet, allergies: b.allergies, cuisine: b.cuisine,
      maxPrepMinutes: b.maxPrepMinutes == null ? null : Number(b.maxPrepMinutes),
      servings: b.servings == null ? null : Number(b.servings),
      pantry: b.pantry && typeof b.pantry === 'object' ? b.pantry : {},
      limit,
    }));
  } catch (e) { next(e); }
});

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

// GET /recipes/:id — full detail for the cooking flow: lines, instructions,
// POST /recipes/generate — AI recipe candidates, deterministically validated.
// Body: {items[], diet[], allergies[], exclusions[], cuisine, mealType,
//        maxPrepMinutes, servings, equipment[], limit}
// AI never supplies nutrition or safety verdicts; every candidate runs the
// full validator before it can be returned. Flag-gated + quota via askJSON.
router.post('/generate', require('../middleware/requireFeature').requireFeature('ai_recipe_generation_enabled'), async (req, res, next) => {
  try {
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Sign in required.' });
    const b = req.body || {};
    const { generateRecipes } = require('../services/recipes/generate');
    const out = await generateRecipes({
      userId,
      items: Array.isArray(b.items) ? b.items.slice(0, 20) : [],
      diet: Array.isArray(b.diet) ? b.diet.slice(0, 10) : [],
      allergies: Array.isArray(b.allergies) ? b.allergies.slice(0, 20) : [],
      exclusions: Array.isArray(b.exclusions) ? b.exclusions.slice(0, 20) : [],
      cuisine: b.cuisine, mealType: b.mealType,
      maxPrepMinutes: b.maxPrepMinutes, servings: b.servings,
      equipment: Array.isArray(b.equipment) ? b.equipment.slice(0, 10) : null,
      limit: Math.min(3, Math.max(1, Number(b.limit) || 3)),
    });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /recipes/save-generated — persist a validated AI candidate.
// The posted candidate is RE-VALIDATED server-side against current
// constraints — a client can never claim a pre-validated recipe. Persists
// as RESEARCH_DRAFT (generated content is never VERIFIED automatically)
// with a disambiguated name (Recipe.recipeName is globally unique, F-9).
router.post('/save-generated', require('../middleware/requireFeature').requireFeature('ai_recipe_generation_enabled'), async (req, res, next) => {
  try {
    const db = require('../lib/prisma').getPrisma();
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Sign in required.' });
    const cand = req.body?.candidate;
    if (!cand || typeof cand !== 'object') return res.status(400).json({ error: 'candidate object required.' });
    const { loadConstraints } = require('../services/recipes/constraints');
    const { validateGeneratedRecipe, loadCatalog, catAllergens, recordValidation } = require('../services/recipes/validate');
    const metrics = require('../services/recipes/metrics');
    const crypto = require('crypto');
    const { normalize } = require('../services/ingredientCsv');

    const constraints = await loadConstraints(userId, {});
    const catalog = await loadCatalog(db);
    const validation = await validateGeneratedRecipe(cand, constraints, { prisma: db, catalog });
    metrics.inc(`save_generated.${validation.status}`);
    await recordValidation(db, { userId, input: { name: cand?.name }, validation });
    if (validation.status === 'FAIL') {
      return res.status(422).json({ error: 'Candidate fails validation — cannot save.', violations: validation.violations });
    }

    const lines = (Array.isArray(cand.ingredients) ? cand.ingredients : []).map((l) => {
      const name = String(l.ingredientName || l.name || '').trim();
      const cat = catalog.byName.get(normalize(name));
      return { name, amountG: Number(l.amountG) || 0, optional: !!l.optional, cat };
    }).filter((l) => l.name && l.amountG > 0);

    const allergens = [...new Set(lines.flatMap((l) => catAllergens(l.cat)))];
    const instructions = (Array.isArray(cand.instructions) ? cand.instructions : [])
      .map((s, i) => (typeof s === 'string' ? { step: i + 1, text: s } : { step: s.step ?? i + 1, ...s }));

    const per = validation.nutrition.perServing || {};
    const sourceKey = `ai:${userId}:${crypto.randomUUID()}`;
    const uniqueName = `${String(cand.name || cand.recipeName || 'Generated recipe').slice(0, 90)} · ai-${crypto.randomUUID().slice(0, 8)}`;
    const recipe = await db.recipe.create({
      data: {
        creatorId: userId,
        recipeName: uniqueName,
        description: String(cand.description || '').slice(0, 500) || null,
        mealType: cand.mealType || null,
        cuisine: cand.cuisine || null,
        prepMinutes: Number.isFinite(Number(cand.estimatedMinutes)) ? Math.min(600, Math.max(1, Math.round(Number(cand.estimatedMinutes)))) : null,
        servings: Number.isFinite(Number(cand.servings)) ? Math.min(20, Math.max(1, Math.round(Number(cand.servings)))) : 1,
        reviewStatus: 'RESEARCH_DRAFT',
        sourceKey,
        isSystem: false,
        instructions,
        allergens,
        safetyNotes: validation.warnings.length ? validation.warnings.slice(0, 10) : null,
        calories: per.calories ?? null,
        proteinG: per.proteinG ?? null,
        carbsG: per.carbsG ?? null,
        fatG: per.fatG ?? null,
        fiberG: per.fiberG ?? null,
        finishedYieldG: validation.nutrition.totalG ?? null,
        portionG: validation.nutrition.totalG != null
          ? Math.round(validation.nutrition.totalG / (Number.isFinite(Number(cand.servings)) ? Math.min(20, Math.max(1, Math.round(Number(cand.servings)))) : 1))
          : null,
        nutritionSource: {
          kind: 'AI_GENERATED_VALIDATED',
          validatorVersion: validation.validatorVersion,
          constraintVersion: constraints.version,
          validationStatus: validation.status,
          computedLines: validation.nutrition.computedLines,
          unresolvedLines: validation.nutrition.missingLines,
          provenance: 'ingredient_per100_deterministic',
        },
        ingredients: {
          create: lines.map((l) => ({
            ingredientId: l.cat?.ingredient?.id || null,
            ingredientName: l.cat?.name || l.name,
            amountG: l.amountG,
            optional: l.optional,
            nutritionSnapshot: l.cat?.ingredient ? { per100: { calories: l.cat.ingredient.caloriesPer100g, proteinG: l.cat.ingredient.proteinPer100g, carbsG: l.cat.ingredient.carbsPer100g, fatG: l.cat.ingredient.fatPer100g, fiberG: l.cat.ingredient.fiberPer100g }, source: 'catalog' } : null,
          })),
        },
      },
    });
    metrics.inc('save_generated.saved');
    res.status(201).json({
      recipe: { id: recipe.id, name: recipe.recipeName, servings: recipe.servings, reviewStatus: recipe.reviewStatus, sourceKey },
      validation: { status: validation.status, violations: validation.violations },
      provenance: { source: 'ai_generated_saved', reviewRequired: true, nutritionRecomputed: true },
    });
  } catch (e) { next(e); }
});

// allergens, verification, caller's engagement.
router.get('/:id', async (req, res, next) => {
  try {
    const db = require('../lib/prisma').getPrisma();
    const userId = req.userId || req.headers['x-user-id'];
    const recipe = await db.recipe.findFirst({
      where: { id: req.params.id, reviewStatus: { not: 'REJECTED' }, OR: [{ isSystem: true }, { creatorId: userId }] },
      include: { ingredients: true, engagements: { where: { userId: String(userId || '') } } },
    });
    if (!recipe) return res.status(404).json({ error: 'Recipe unavailable' });
    res.json({ ...recipe, engagement: recipe.engagements[0] || null, engagements: undefined });
  } catch (e) { next(e); }
});

// PUT /recipes/:id/engagement — upsert favorite/rating/notes/customData.
router.put('/:id/engagement', async (req, res, next) => {
  try {
    const db = require('../lib/prisma').getPrisma();
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Sign in required.' });
    const recipe = await db.recipe.findFirst({ where: { id: req.params.id, reviewStatus: { not: 'REJECTED' } } });
    if (!recipe) return res.status(404).json({ error: 'Recipe unavailable' });
    const b = req.body || {};
    if (b.rating != null && (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5)) return res.status(400).json({ error: 'rating must be an integer 1–5' });
    const data = {
      ...(b.favorite !== undefined ? { favorite: !!b.favorite } : {}),
      ...(b.rating !== undefined ? { rating: b.rating } : {}),
      ...(b.notes !== undefined ? { notes: String(b.notes).slice(0, 2000) } : {}),
      ...(b.customData !== undefined ? { customData: b.customData } : {}),
    };
    const engagement = await db.recipeEngagement.upsert({
      where: { userId_recipeId: { userId: String(userId), recipeId: recipe.id } },
      create: { userId: String(userId), recipeId: recipe.id, ...data },
      update: data,
    });
    res.json({ engagement });
  } catch (e) { next(e); }
});

// POST /recipes/:id/customize — opt-in AI customization (P5).
// The model proposes line edits ONLY; the backend re-resolves every named
// ingredient, clamps quantities, rejects allergen conflicts, and recomputes
// nutrition from linked per-100g profiles. AI numbers are never trusted.
router.post('/:id/customize', require('../middleware/requireFeature').requireFeature('recipe_customization_ai_enabled'), async (req, res, next) => {
  try {
    const db = require('../lib/prisma').getPrisma();
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Sign in required.' });
    const { normalize } = require('../services/ingredientCsv');
    const { computeFromLines } = require('../services/recipeImport');
    const { askJSON } = require('../services/aiProvider');
    const { loadConstraints, hasTerm, violatesHard } = require('../services/recipes/constraints');
    const { validateGeneratedRecipe, recordValidation } = require('../services/recipes/validate');
    const metrics = require('../services/recipes/metrics');

    const recipe = await db.recipe.findFirst({
      where: { id: req.params.id, reviewStatus: { not: 'REJECTED' }, OR: [{ isSystem: true }, { creatorId: String(userId) }] },
      include: { ingredients: true },
    });
    if (!recipe) return res.status(404).json({ error: 'Recipe unavailable' });

    const b = req.body || {};
    const request = String(b.request || '').trim();
    if (!request || request.length > 500) return res.status(400).json({ error: 'request must be 1–500 characters.' });
    const targetServings = Number.isFinite(Number(b.servings)) ? Math.min(20, Math.max(1, Math.round(Number(b.servings)))) : null;
    // Server-side constraints are authoritative (F-1): profile allergies and
    // saved restrictions always apply; request allergies can only narrow.
    const constraints = await loadConstraints(userId, { allergies: b.allergies });
    const userAllergenTerms = constraints.hard.allergenTerms;

    const lineSummary = recipe.ingredients.map((l) => ({ name: l.ingredientName, amountG: l.amountG, optional: l.optional }));
    const out = await askJSON('recipe_customization', {
      changes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            action: { type: 'string', enum: ['set_amount', 'remove', 'add', 'substitute'] },
            ingredientName: { type: 'string' },
            newIngredientName: { type: 'string' },
            amountG: { type: 'number' },
          },
          required: ['action', 'ingredientName', 'newIngredientName', 'amountG'],
        },
      },
      notes: { type: 'string' },
      servings: { type: 'number' },
    },
      'You are adjusting a recipe for a user. You may ONLY change ingredient amounts, remove optional/existing lines, add common ingredients, or substitute one ingredient for another. ' +
      'You never invent nutrient values. Amounts are grams. Respect the user request literally; if you cannot safely satisfy it, return empty changes and explain in notes.',
      `Recipe: ${recipe.recipeName} (servings ${recipe.servings})\nIngredients: ${JSON.stringify(lineSummary)}\nUser request: ${request}${targetServings ? `\nTarget servings: ${targetServings}` : ''}${userAllergenTerms.size ? `\nUser allergies (never introduce these, including derivatives): ${[...userAllergenTerms].slice(0, 40).join(', ')}` : ''}`,
      null, userId, { maxOutputTokens: 1200 });

    // ---- Backend validation ----
    const catalog = await db.ingredientCatalog.findMany({
      where: { usable: true },
      include: { ingredient: { select: { id: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true, attributes: { select: { attribute: true } } } } },
    });
    const byName = new Map();
    for (const c of catalog) for (const n of [c.normalizedName, ...c.aliases]) if (c.ingredient && !byName.has(n)) byName.set(n, c);
    const catAllergens = (c) => {
      const a = c?.sourceRecord && typeof c.sourceRecord === 'object' ? c.sourceRecord.allergens : null;
      return Array.isArray(a) ? a.map(normalize) : (typeof a === 'string' ? a.split(/[,;]/).map(normalize).filter(Boolean) : []);
    };

    const warnings = [];
    const rejected = [];
    const lines = recipe.ingredients.map((l) => ({
      ingredientId: l.ingredientId, ingredientName: l.ingredientName, amountG: l.amountG, optional: l.optional,
      _per100: null,
    }));
    const per100For = (ingredientId) => {
      const c = catalog.find((x) => x.ingredient?.id === ingredientId);
      return c?.ingredient ? { calories: c.ingredient.caloriesPer100g, proteinG: c.ingredient.proteinPer100g, carbsG: c.ingredient.carbsPer100g, fatG: c.ingredient.fatPer100g, fiberG: c.ingredient.fiberPer100g } : null;
    };
    for (const l of lines) l._per100 = l.ingredientId ? per100For(l.ingredientId) : null;

    const findLine = (name) => lines.find((l) => normalize(l.ingredientName) === normalize(name)) ||
      lines.find((l) => normalize(l.ingredientName).includes(normalize(name)));

    const applied = [];
    for (const ch of Array.isArray(out.changes) ? out.changes.slice(0, 20) : []) {
      const act = String(ch.action || '');
      const target = findLine(ch.ingredientName);
      const g = Number(ch.amountG);
      if (act === 'set_amount' || act === 'substitute' || act === 'add') {
        if (!Number.isFinite(g) || g <= 0 || g > 2000) { rejected.push({ change: ch, reason: 'amount out of bounds' }); continue; }
      }
      if ((act === 'set_amount' || act === 'remove' || act === 'substitute') && !target) {
        rejected.push({ change: ch, reason: 'no such ingredient in recipe' }); continue;
      }
      if (act === 'set_amount') {
        target.amountG = g;
        applied.push(`Set ${target.ingredientName} to ${g}g`);
      } else if (act === 'remove') {
        target._removed = true;
        applied.push(`Removed ${target.ingredientName}`);
      } else if (act === 'substitute' || act === 'add') {
        const newName = String(act === 'add' ? ch.ingredientName : ch.newIngredientName || '').trim();
        // Hard-constraint term match on the raw name runs BEFORE catalog
        // resolution: an unresolvable "peanut oil" must read as an allergy
        // conflict, not a catalog miss.
        const nameViol = violatesHard(constraints.hard, { text: newName, allergens: [], category: null, tags: [], attributes: [] });
        if (nameViol) {
          const reason = nameViol.ruleId.startsWith('ALLERGEN')
            ? `"${newName}" conflicts with your allergies`
            : `"${newName}" conflicts with your saved restrictions`;
          rejected.push({ change: ch, reason }); continue;
        }
        const cat = byName.get(normalize(newName));
        if (!cat?.ingredient) { rejected.push({ change: ch, reason: `"${newName}" not in food catalog` }); continue; }
        // Added ingredients run through the same hard-constraint check as
        // matching: allergens (declared + name text), saved exclusions, and
        // APPROVED condition-rule attributes.
        const addViol = violatesHard(constraints.hard, {
          text: cat.name,
          allergens: catAllergens(cat),
          category: cat.category,
          tags: Array.isArray(cat.sourceRecord?.tags) ? cat.sourceRecord.tags : [],
          attributes: (cat.ingredient.attributes || []).map((a) => a.attribute),
        });
        if (addViol) {
          const reason = addViol.ruleId.startsWith('ALLERGEN')
            ? `"${newName}" conflicts with your allergies`
            : `"${newName}" conflicts with your saved restrictions`;
          rejected.push({ change: ch, reason }); continue;
        }
        const newline = { ingredientId: cat.ingredient.id, ingredientName: cat.name, amountG: g, optional: act === 'add', _per100: per100For(cat.ingredient.id) };
        if (act === 'substitute') Object.assign(target, newline, { optional: target.optional });
        else lines.push(newline);
        applied.push(act === 'add' ? `Added ${cat.name} ${g}g` : `Swapped ${ch.ingredientName} → ${cat.name} ${g}g`);
      } else {
        rejected.push({ change: ch, reason: 'unknown action' });
      }
    }
    const finalLines = lines.filter((l) => !l._removed);
    if (!finalLines.length) return res.status(422).json({ error: 'Customization would remove every ingredient.', rejected });

    const servings = targetServings || (Number.isFinite(Number(out.servings)) ? Math.min(20, Math.max(1, Math.round(Number(out.servings)))) : recipe.servings);
    const perServing = computeFromLines(finalLines, {
      servings,
      finishedYieldG: servings === recipe.servings ? recipe.finishedYieldG : null,
      portionG: servings === recipe.servings ? recipe.portionG : null,
    });

    // Every transformation re-validates the whole recipe against the user's
    // authoritative constraints — the validator independently recomputes the
    // proposal (schema → identity → hard filters → nutrition → safety).
    const validation = await validateGeneratedRecipe({
      name: recipe.recipeName,
      servings,
      allergens: recipe.allergens,
      finishedYieldG: recipe.finishedYieldG,
      portionG: recipe.portionG,
      ingredients: finalLines.map((l) => ({ ingredientName: l.ingredientName, ingredientId: l.ingredientId, amountG: l.amountG, optional: l.optional })),
      instructions: recipe.instructions || [],
    }, constraints, { prisma: db });
    for (const v of validation.violations) {
      if (v.severity === 'warn') warnings.push(v.reason);
      else warnings.push(`${v.ruleId}: ${v.reason}`);
    }
    metrics.inc(`customize.validate.${validation.status}`);
    recordValidation(db, { userId, input: { name: `${recipe.recipeName} (customized)` }, validation });

    // Safety: if a swap introduced a user allergen via recipe-level allergen
    // list, warn explicitly (declared allergens, not a guarantee).
    const declared = (recipe.allergens || []).map(normalize);
    const allergenNote = declared.some((a) => hasTerm(userAllergenTerms, a))
      ? 'This recipe declares an allergen on your list — review before cooking.'
      : null;
    if (allergenNote) warnings.push(allergenNote);
    if (targetServings && targetServings !== recipe.servings) warnings.push('Yield re-scaled by servings; finished weights are estimates.');

    res.json({
      recipe: { id: recipe.id, name: recipe.recipeName, servings, verificationLevel: 'ESTIMATED' },
      changesApplied: applied,
      rejected,
      notes: String(out.notes || '').slice(0, 1000),
      proposedLines: finalLines.map((l) => ({ ingredientId: l.ingredientId, ingredientName: l.ingredientName, amountG: Math.round(l.amountG * 10) / 10, optional: l.optional })),
      perServing,
      warnings,
      validation: { status: validation.status, violations: validation.violations, validatorVersion: validation.validatorVersion },
      provenance: { source: 'ai_customization', reviewRequired: true, nutritionRecomputed: true, revalidated: true },
    });
  } catch (e) { next(e); }
});

// User-authored recipes retain a calculation snapshot; later catalog imports never rewrite them.
router.post('/',async(req,res,next)=>{try{
 const b=req.body||{};if(typeof b.name!=='string'||!b.name.trim()||b.name.length>200)return res.status(400).json({error:'Recipe name required'});
 const calc=await require('../services/ingredientNutrition').calculateRecipe(b.ingredients,b.yieldGrams);
 const recipe=await require('../lib/prisma').getPrisma().recipe.create({data:{creatorId:req.userId,recipeName:b.name,servings:1,portionG:calc.yieldGrams,...Object.fromEntries(['calories','proteinG','carbsG','fatG','fiberG'].map(k=>[k,calc.totals[k]])),nutritionSource:{source:'central-ingredient-catalog',...calc},ingredients:{create:calc.ingredients.map(i=>({ingredientId:i.ingredientId,ingredientName:i.name,amountG:i.grams,nutritionSnapshot:i}))}}});res.status(201).json(recipe);
}catch(e){next(e);}});
module.exports = router;
