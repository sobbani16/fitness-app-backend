// Relational ingredient-based recipe matching (v2).
//
// Inputs may be canonical ingredientIds, catalog identityKeys, or free-text
// names that resolve through IngredientCatalog name/alias matching. A recipe
// line "matches" when its linked ingredient is among the selected set;
// unlinked lines fall back to normalized name comparison. Water/salt-type
// staples never count as required or missing.
//
// Output contract per recipe:
//   recipe{id,name,cuisine,region,mealType,servings,portionG,prepMinutes,
//          perServing,verificationLevel,allergens}
//   availableIngredients[]   — required lines satisfied by the selection
//   missingRequired[]        — required lines NOT satisfied
//   missingOptional[]        — optional lines not satisfied (never penalized)
//   insufficientQuantities[] — user gave a known amount < line needs
//   quantityAssumed          — true when user gave no amounts (we never
//                              pretend unknown quantity means "have enough")
//   coverage (0–1 of required lines), matchScore, status, reasons[]
//
// status: ready | missing-one | missing-few | partial | insufficient-quantity
const { getPrisma } = require('../lib/prisma');
const { normalize } = require('./ingredientCsv');
const { httpError } = require('../lib/errors');
const { loadConstraints, violatesHard, hasTerm, textHasTerm } = require('./recipes/constraints');

// Seasonings/staples assumed in a home kitchen. Users can narrow this to just
// water/salt/ice (pantry.minimal) or extend it (pantry.extra) per request —
// never extended automatically to every spice or sauce.
const PANTRY_CORE = new Set(['water', 'salt', 'ice', 'water for soaking', 'water for cooking', 'warm water', 'ice cubes']);
const PANTRY_DEFAULT = new Set([...PANTRY_CORE, 'black pepper', 'pepper', 'salt and pepper', 'salt to taste']);

// Diet → ingredient-catalog categories a recipe may not contain. Conservative:
// category strings come from our catalog; absence of a match is NOT proof a
// recipe is compliant — flagged recipes are excluded, not the reverse.
const DIET_RULES = {
  vegan: ['Animal protein', 'Seafood', 'Dairy', 'Eggs'],
  vegetarian: ['Animal protein', 'Seafood'],
  eggetarian: ['Animal protein', 'Seafood'],
  pescatarian: ['Animal protein'],
};
const EGG_KEYS = new Set(['egg', 'eggs', 'egg whole', 'egg white', 'egg yolk', 'whole egg', 'omlette', 'omelet', 'omelette']);
const eggLike = (n) => [...EGG_KEYS].some((e) => normalize(n).includes(e));

const ALIAS_TOKENS = { curd: 'yogurt', brinjal: 'eggplant', aubergine: 'eggplant', ladyfinger: 'okra', bhindi: 'okra', cilantro: 'coriander', atta: 'whole wheat flour', sooji: 'semolina', rava: 'semolina', paneer: 'cottage cheese' };

function inputVariants(raw) {
  const w = normalize(raw);
  const v = new Set([w]);
  if (w.endsWith('es')) v.add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) v.add(w.slice(0, -1));
  v.add(`${w}s`);
  if (ALIAS_TOKENS[w]) v.add(ALIAS_TOKENS[w]);
  return [...v].filter(Boolean);
}

async function loadCatalogIndex(prisma) {
  return require('./recipes/cache').cachedCatalog(prisma, 'match', async () => prisma.ingredientCatalog.findMany({
    where: { usable: true },
    select: { id: true, identityKey: true, normalizedName: true, aliases: true, category: true, sourceRecord: true, ingredient: { select: { id: true, name: true, caloriesPer100g: true, proteinPer100g: true, carbsPer100g: true, fatPer100g: true, fiberPer100g: true } } },
  }));
}

// Resolve mixed inputs {ingredientId}|{identityKey}|{name}[, amountG] →
// {selected: Map<ingredientId, {amountG, name}>, unresolved: []}.
function resolveInputs(catalog, items) {
  const selected = new Map();
  const unresolved = [];
  for (const item of items) {
    const id = typeof item === 'object' && item !== null ? (item.ingredientId || item.ingredientCatalogId || null) : null;
    const name = typeof item === 'string' ? item : (item.name || item.ingredientName || null);
    const amountG = typeof item === 'object' && item !== null && Number.isFinite(Number(item.amountG)) ? Number(item.amountG) : null;

    let hits = [];
    if (id) {
      hits = catalog.filter((c) => c.id === id || c.ingredient?.id === id || c.identityKey === id);
      if (!hits.length) {
        // Unknown id — treat as an opaque user ingredient id so quantity
        // tracking still works; never fabricate a catalog resolution.
        hits = [{ ingredient: { id }, identityKey: null, normalizedName: name || id, category: null, sourceRecord: null, direct: true }];
      }
    } else if (name) {
      const vars = inputVariants(name);
      hits = catalog.filter((c) => c.ingredient?.id && vars.some((v) => c.normalizedName === v || c.aliases.includes(v) || c.normalizedName.includes(v)));
      if (!hits.length) hits = catalog.filter((c) => c.ingredient?.id && vars.some((v) => v.length >= 3 && c.normalizedName.split(' ').some((t) => t === v)));
    }
    if (hits.length) {
      for (const h of hits) {
        const iid = h.ingredient.id;
        if (!selected.has(iid)) selected.set(iid, { name: h.ingredient.name || h.normalizedName, amountG });
      }
    } else {
      unresolved.push(name || id);
    }
  }
  return { selected, unresolved };
}

function lineAllergens(line, catByIngId) {
  const cat = line.ingredientId ? catByIngId.get(line.ingredientId) : null;
  const rec = cat?.sourceRecord && typeof cat.sourceRecord === 'object' ? cat.sourceRecord : null;
  const a = rec?.allergens;
  if (Array.isArray(a)) return a.map(normalize);
  if (typeof a === 'string') return a.split(/[,;]/).map(normalize).filter(Boolean);
  return [];
}

async function matchIngredients({
  userId,
  items,
  ingredients,       // legacy: plain name array
  diet = [],
  allergies = [],
  cuisine = null,
  maxPrepMinutes = null,
  servings = null,
  limit = 12,
  pantry = {},
}) {
  if (!userId) throw httpError(401, 'Sign in required.');
  const raw = Array.isArray(items) && items.length ? items : (Array.isArray(ingredients) ? ingredients : []);
  if (!raw.length || raw.length > 20) throw httpError(400, 'items must be 1–20 ingredients.');
  const prisma = getPrisma();

  const catalog = await loadCatalogIndex(prisma);
  const catByIngId = new Map();
  for (const c of catalog) if (c.ingredient?.id) catByIngId.set(c.ingredient.id, c);

  const { selected, unresolved } = resolveInputs(catalog, raw);
  const quantityAssumed = raw.every((i) => typeof i === 'string' || !Number.isFinite(Number(i.amountG)));

  const wantedNames = raw.map((i) => (typeof i === 'string' ? i : i.name || i.ingredientName || '')).map(normalize).filter(Boolean);
  const wantedExpanded = new Set();
  for (const w of wantedNames) for (const v of inputVariants(w)) wantedExpanded.add(v);

  // Server-side constraints are authoritative (F-1): profile allergies,
  // NEVER_RECOMMEND foods, saved restrictions, and APPROVED condition-rule
  // blocks merge with request params — which can only narrow, never widen.
  const constraints = await loadConstraints(userId, { allergies, diet });
  const hard = constraints.hard;
  const dietSet = new Set((Array.isArray(diet) ? diet : []).map(normalize).filter(Boolean));
  const eggetarian = dietSet.has('eggetarian') || hard.patterns.some((p) => p.key === 'eggetarian');
  const bannedCats = new Set([...hard.bannedCategories]);
  for (const d of dietSet) for (const c of DIET_RULES[d] || []) bannedCats.add(normalize(c));

  const pantrySet = new Set([...(pantry.minimal ? PANTRY_CORE : PANTRY_DEFAULT), ...(Array.isArray(pantry.extra) ? pantry.extra.map(normalize) : [])]);
  const isPantryLine = (n) => pantrySet.has(normalize(n));

  const recipes = await prisma.recipe.findMany({
    where: {
      reviewStatus: { not: 'REJECTED' },
      OR: [{ isSystem: true }, { creatorId: userId }],
      ...(cuisine ? { cuisine: { equals: cuisine, mode: 'insensitive' } } : {}),
    },
    include: { ingredients: true },
  });

  // IngredientAttribute lookup for condition-rule blocks — one query across
  // every candidate recipe's linked ingredients, only when rules can fire.
  const attrsByIng = new Map();
  if (hard.bannedAttributes.size) {
    const linkedIds = [...new Set(recipes.flatMap((r) => r.ingredients.map((l) => l.ingredientId).filter(Boolean)))];
    if (linkedIds.length) {
      const rows = await prisma.ingredientAttribute.findMany({ where: { ingredientId: { in: linkedIds } } });
      for (const row of rows) {
        if (!attrsByIng.has(row.ingredientId)) attrsByIng.set(row.ingredientId, []);
        attrsByIng.get(row.ingredientId).push(row.attribute);
      }
    }
  }
  const attrsOf = (r) => [...new Set(r.ingredients.flatMap((l) => (l.ingredientId ? attrsByIng.get(l.ingredientId) || [] : [])))];

  const results = [];
  let excludedAllergy = 0;
  let excludedDiet = 0;
  let excludedTime = 0;
  let excludedExclusion = 0;
  let excludedCondition = 0;

  for (const r of recipes) {
    if (maxPrepMinutes && r.prepMinutes && r.prepMinutes > maxPrepMinutes) { excludedTime++; continue; }

    const lines = r.ingredients.filter((l) => !isPantryLine(l.ingredientName));
    const required = lines.filter((l) => !l.optional);
    const optional = lines.filter((l) => l.optional);
    if (!required.length) continue;

    // Hard-constraint check (server-merged): declared + text allergens,
    // exclusion terms (NEVER_RECOMMEND / exclude: / request), banned
    // nutritionSource tags, APPROVED condition-rule attributes.
    const viol = violatesHard(hard, {
      text: [r.recipeName, ...lines.map((l) => l.ingredientName)].join(' '),
      allergens: [...(r.allergens || []).map(normalize), ...lines.flatMap((l) => lineAllergens(l, catByIngId))],
      tags: Array.isArray(r.nutritionSource?.tags) ? r.nutritionSource.tags : [],
      attributes: attrsOf(r),
    });
    if (viol) {
      if (viol.ruleId.startsWith('ALLERGEN')) excludedAllergy++;
      else if (viol.ruleId === 'CONDITION_ATTR') excludedCondition++;
      else excludedExclusion++;
      continue;
    }

    // Diet exclusion via catalog categories. Egg-like lines are exempt under
    // 'eggetarian' (they're in 'Animal protein' alongside meat/fish there).
    if (bannedCats.size) {
      const hit = required.find((l) => {
        const cat = l.ingredientId ? catByIngId.get(l.ingredientId) : null;
        if (!cat?.category || !hasTerm(bannedCats, cat.category)) return false;
        if (eggetarian && eggLike(l.ingredientName)) return false;
        return true;
      });
      if (hit) { excludedDiet++; continue; }
    }

    const has = (l) => {
      if (l.ingredientId && selected.has(l.ingredientId)) return true;
      const ln = normalize(l.ingredientName);
      return [...wantedExpanded].some((w) => w.length >= 3 && (ln === w || ln.includes(` ${w}`) || ln.startsWith(`${w} `) || ln.includes(w)));
    };

    const available = required.filter(has);
    const missingRequired = required.filter((l) => !has(l));
    const missingOptional = optional.filter((l) => !has(l));
    const matchedOpt = optional.filter(has);
    if (!available.length && !matchedOpt.length) continue;

    // Quantity sufficiency — only judged when the user supplied amounts.
    const insufficient = [];
    if (!quantityAssumed) {
      for (const l of available) {
        const sel = l.ingredientId ? selected.get(l.ingredientId) : null;
        if (sel && sel.amountG != null && l.amountG && sel.amountG < l.amountG) {
          insufficient.push({ ingredientName: l.ingredientName, needG: l.amountG, haveG: sel.amountG });
        }
      }
    }

    const coverage = available.length / required.length;
    const simplicity = 1 / Math.max(1, required.length); // prefer simple recipes
    const verifiedBonus = r.reviewStatus === 'VERIFIED' ? 0.1 : r.reviewStatus === 'SYSTEM' ? 0.05 : 0;
    const cuisineBonus = cuisine && r.cuisine && normalize(r.cuisine) === normalize(cuisine) ? 0.05 : 0;
    const matchScore = Math.round((coverage * 0.7 + simplicity * 0.15 + matchedOpt.length * 0.02 + verifiedBonus + cuisineBonus) * 1000) / 1000;

    const status = insufficient.length && missingRequired.length === 0 ? 'insufficient-quantity'
      : missingRequired.length === 0 ? 'ready'
      : missingRequired.length === 1 ? 'missing-one'
      : missingRequired.length <= Math.ceil(required.length / 2) ? 'missing-few'
      : 'partial';

    const reasons = [];
    if (available.length) reasons.push(`You have ${available.length} of ${required.length} required ingredients`);
    if (missingRequired.length) reasons.push(`Missing ${missingRequired.length}: ${missingRequired.slice(0, 3).map((l) => l.ingredientName).join(', ')}`);
    if (insufficient.length) reasons.push(`Quantity short on ${insufficient.map((i) => i.ingredientName).join(', ')}`);
    if (quantityAssumed && available.length) reasons.push('Quantities not provided — shown amounts are recipe targets');
    if (r.prepMinutes) reasons.push(`~${r.prepMinutes} min`);
    if (verifiedBonus) reasons.push(r.reviewStatus === 'VERIFIED' ? 'Verified recipe' : 'System recipe');

    results.push({
      recipe: {
        id: r.id, name: r.recipeName, cuisine: r.cuisine, region: r.region, mealType: r.mealType,
        servings: r.servings, portionG: r.portionG, prepMinutes: r.prepMinutes,
        perServing: { calories: r.calories, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG, fiberG: r.fiberG },
        verificationLevel: r.reviewStatus === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED',
        allergens: r.allergens || [],
      },
      availableIngredients: available.map((l) => ({ name: l.ingredientName, amountG: l.amountG })),
      missingRequired: missingRequired.map((l) => ({ name: l.ingredientName, amountG: l.amountG })),
      missingOptional: missingOptional.map((l) => ({ name: l.ingredientName, amountG: l.amountG })),
      matchedOptional: matchedOpt.map((l) => l.ingredientName),
      insufficientQuantities: insufficient,
      quantityAssumed,
      coverage: Math.round(coverage * 100) / 100,
      matchScore,
      status,
      reasons,
    });
  }

  // ---- Phase 9: deterministic ranking of the survivors ---------------------
  // Reached ONLY by recipes that passed every hard check above — ranking can
  // never resurrect an excluded recipe. Signals: nutrition fit vs MacroGoal,
  // prep-time fit, LOVE/LIKE + cuisine preferences, DISLIKE (soft penalty
  // only — never removes), and the user's own engagement (favorite/rating).
  const engagements = results.length && prisma.recipeEngagement?.findMany
    ? await prisma.recipeEngagement.findMany({ where: { userId, recipeId: { in: results.map((r) => r.recipe.id) } } }).catch(() => [])
    : [];
  const engMap = new Map((engagements || []).map((e) => [e.recipeId, e]));

  const mealShare = constraints.limits?.caloriesTarget ? constraints.limits.caloriesTarget / 3 : null;
  const proteinShare = constraints.limits?.proteinTarget ? constraints.limits.proteinTarget / 3 : null;
  for (const res of results) {
    let bonus = 0;
    const breakdown = { base: res.matchScore };
    const r = res.recipe;
    if (mealShare && Number.isFinite(r.perServing?.calories)) {
      const fit = 0.10 * (1 - Math.min(1, Math.abs(r.perServing.calories - mealShare) / mealShare));
      bonus += fit; breakdown.nutritionFit = +fit.toFixed(3);
    }
    if (proteinShare && Number.isFinite(r.perServing?.proteinG) && r.perServing.proteinG >= proteinShare) {
      bonus += 0.04; breakdown.proteinFit = 0.04;
    }
    if (maxPrepMinutes && r.prepMinutes) {
      const fit = 0.05 * (1 - r.prepMinutes / maxPrepMinutes);
      bonus += fit; breakdown.timeFit = +fit.toFixed(3);
    }
    const txt = r.name + ' ' + res.availableIngredients.map((i) => i.name).join(' ');
    for (const l of constraints.soft?.likes || []) {
      if (textHasTerm(txt, l.name)) { const v = l.love ? 0.08 : 0.04; bonus += v; breakdown.preference = +(((breakdown.preference || 0) + v).toFixed(3)); }
    }
    for (const d of constraints.soft?.dislikes || []) {
      if (textHasTerm(txt, d)) { bonus -= 0.06; breakdown.preference = +(((breakdown.preference || 0) - 0.06).toFixed(3)); }
    }
    if (r.cuisine && (constraints.soft?.cuisines || []).some((c) => normalize(c) === normalize(r.cuisine))) {
      bonus += 0.03; breakdown.cuisinePref = 0.03;
    }
    const eng = engMap.get(r.id);
    if (eng?.favorite) { bonus += 0.06; breakdown.favorite = 0.06; }
    if (Number.isInteger(eng?.rating)) { const v = 0.02 * (eng.rating - 3) / 2; bonus += v; breakdown.rating = +v.toFixed(3); }
    res.rankScore = Math.round((res.matchScore + bonus) * 1000) / 1000;
    res.rankBreakdown = breakdown;
  }

  results.sort((a, b) => {
    const order = { ready: 0, 'insufficient-quantity': 1, 'missing-one': 2, 'missing-few': 3, partial: 4 };
    return (order[a.status] - order[b.status]) || ((b.rankScore ?? b.matchScore) - (a.rankScore ?? a.matchScore)) || a.recipe.name.localeCompare(b.recipe.name);
  });

  return {
    results: results.slice(0, limit),
    totalMatched: results.length,
    unresolvedInputs: unresolved,
    quantityAssumed,
    excluded: { allergy: excludedAllergy, diet: excludedDiet, prepTime: excludedTime, exclusion: excludedExclusion, condition: excludedCondition },
  };
}

// Backward-compatible wrapper used by POST /recipes/match (names only).
async function matchRecipes({ userId, ingredients, limit = 12 }) {
  const out = await matchIngredients({ userId, items: ingredients, limit });
  return {
    unresolvedInputs: out.unresolvedInputs,
    results: out.results.map((r) => ({
      recipe: r.recipe,
      matched: r.availableIngredients.map((i) => i.name),
      missing: r.missingRequired.map((i) => i.name),
      coverage: r.coverage,
    })),
  };
}

module.exports = { matchIngredients, matchRecipes };
