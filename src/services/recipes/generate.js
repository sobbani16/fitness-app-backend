// AI recipe generation (Phase 4) + regeneration/fallback (Phase 8).
//
// AI produces CANDIDATES ONLY. Each candidate is independently validated by
// the deterministic pipeline before it can be presented. AI output is never
// trusted for nutrition, safety, or medical claims — the validator recomputes
// all of it and can reject, clarify, or require review.
//
// Flow:
//   loadConstraints → resolve available items → askJSON candidates →
//   validateGeneratedRecipe each → on total failure ONE constrained
//   correction attempt (failed ruleIds fed back) → fall back to an eligible
//   VERIFIED recipe via matchIngredients → else NO_ELIGIBLE_RECIPE.
//
// Never: bypass validation, weaken restrictions to improve hit rate, or
// retry an impossible constraint combination.

const { getPrisma } = require('../../lib/prisma');
const { normalize } = require('../ingredientCsv');
const { askJSON } = require('../aiProvider');
const { loadConstraints } = require('./constraints');
const { validateGeneratedRecipe, loadCatalog } = require('./validate');
const { matchIngredients } = require('../recipeMatch');

const GENERATOR_VERSION = 'recipe-generator-v1';
const MAX_CANDIDATES = 3;
const MAX_RETRIES = 1;

// Prompt-injection hygiene: user-supplied names enter the prompt only after
// control-char stripping and length capping. Exclusion terms are data, never
// instructions.
const clean = (s, max = 60) => String(s || '').replace(/[\x00-\x1f<>{}\[\]\\`"']+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const CANDIDATE_PROPERTIES = {
  candidates: {
    type: 'array',
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        servings: { type: 'number' },
        estimatedMinutes: { type: 'number' },
        mealType: { type: 'string' },
        ingredients: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              ingredientName: { type: 'string' },
              amountG: { type: 'number' },
              unit: { type: 'string' },
              optional: { type: 'boolean' },
            },
            required: ['ingredientName', 'amountG', 'unit', 'optional'],
          },
        },
        instructions: { type: 'array', items: { type: 'string' } },
        missingIngredients: { type: 'array', items: { type: 'string' } },
        substitutions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              ingredientName: { type: 'string' },
              forIngredient: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['ingredientName', 'forIngredient', 'note'],
          },
        },
      },
      required: ['name', 'description', 'servings', 'estimatedMinutes', 'mealType', 'ingredients', 'instructions', 'missingIngredients', 'substitutions'],
    },
  },
  notes: { type: 'string' },
};

const SYSTEM_PROMPT =
  'You generate recipe candidates for a food app. Rules: ' +
  '(1) Only use ingredients from the AVAILABLE list plus plain water/salt/pepper. ' +
  '(2) Never include any ALLERGY or EXCLUDED items — not as ingredients, garnishes, sauces, or toppings. ' +
  '(3) Amounts are grams. Servings must match the request. Instructions must be complete, safe, and reference only listed ingredients — include internal-temperature guidance for meat, poultry, seafood, and eggs. ' +
  '(4) Never invent nutrition numbers, health claims, certifications, or medical advice. ' +
  '(5) If the constraints make a safe recipe impossible, return an empty candidates array and explain in notes.';

function constraintSummary(constraints) {
  const h = constraints.hard;
  const parts = [];
  if (h.allergenTerms.size) parts.push(`ALLERGY (never include, including derivatives): ${[...h.allergenTerms].slice(0, 40).join(', ')}`);
  const excl = [...h.excludeTerms].filter((t) => !h.allergenTerms.has(t));
  if (excl.length) parts.push(`EXCLUDED (never include): ${excl.slice(0, 40).join(', ')}`);
  if (h.patterns.length) parts.push(`DIETARY PATTERNS: ${h.patterns.map((p) => p.key.replace(/_/g, ' ')).join(', ')}`);
  if (h.medicalConditions.length) parts.push(`MEDICAL CONDITIONS: ${h.medicalConditions.map((m) => m.name).join(', ')} — follow the excluded attributes only`);
  if (constraints.equipment.length) parts.push(`EQUIPMENT AVAILABLE: ${constraints.equipment.join(', ')}`);
  if (constraints.limits) parts.push(`DAILY TARGETS (per serving should be a reasonable fraction): ~${Math.round(constraints.limits.caloriesTarget)} kcal, ${Math.round(constraints.limits.proteinTarget)}g protein, ${Math.round(constraints.limits.carbsTarget)}g carbs, ${Math.round(constraints.limits.fatTarget)}g fat`);
  return parts.join('\n') || 'No restrictions.';
}

function usableStatus(v) {
  // Candidates that need clarification/review are returned but clearly
  // marked — never labeled validated. FAIL candidates are dropped.
  return v.status !== 'FAIL';
}

async function validateAll(candidates, constraints, ctx) {
  const usable = [];
  const rejected = [];
  for (const cand of (candidates || []).slice(0, MAX_CANDIDATES)) {
    const validation = await validateGeneratedRecipe(cand, constraints, ctx);
    if (usableStatus(validation)) {
      usable.push({ candidate: cand, validation });
    } else {
      rejected.push({ name: cand?.name || 'unnamed', ruleIds: validation.violations.map((x) => x.ruleId), violations: validation.violations });
    }
  }
  return { usable, rejected };
}

async function callProvider(userId, promptText) {
  return askJSON('recipe_generation', CANDIDATE_PROPERTIES, SYSTEM_PROMPT, promptText, null, userId, { maxOutputTokens: 3000 });
}

/**
 * Generate + validate recipe candidates.
 * @returns {Promise<{status: 'ok'|'needs_review'|'no_eligible_recipe',
 *   candidates: [{candidate, validation}], fallback: object[],
 *   rejected: [], meta: {}}>}
 */
async function generateRecipes({
  userId,
  items = [],
  diet = [],
  allergies = [],
  exclusions = [],
  cuisine = null,
  mealType = null,
  maxPrepMinutes = null,
  servings = null,
  equipment = null,
  limit = MAX_CANDIDATES,
}) {
  const prisma = getPrisma();
  const constraints = await loadConstraints(userId, { allergies, diet, exclusions, equipment, cuisine, maxPrepMinutes, servings });
  const catalog = await loadCatalog(prisma);
  const ctx = { prisma, catalog };

  // Resolve available inputs against the catalog (same name/alias matching as
  // matching) — unresolved names go into the prompt as unavailable-context so
  // the model doesn't treat them as usable.
  const available = [];
  const unresolved = [];
  for (const item of Array.isArray(items) ? items : []) {
    const name = typeof item === 'string' ? item : item?.name || item?.ingredientName || '';
    const amountG = typeof item === 'object' && item !== null && Number.isFinite(Number(item.amountG)) ? Number(item.amountG) : null;
    const n = normalize(name);
    const hit = n && catalog.byName.get(n);
    if (hit) available.push(`${clean(hit.name)}${amountG ? ` (${Math.round(amountG)}g)` : ''}`);
    else if (n) unresolved.push(clean(name));
  }

  const servingsN = Number.isFinite(Number(servings)) ? Math.min(20, Math.max(1, Math.round(Number(servings)))) : 2;
  const promptText = [
    `Generate up to ${MAX_CANDIDATES} distinct recipe candidates.`,
    `Servings: ${servingsN}`,
    mealType ? `Meal type: ${clean(mealType, 30)}` : null,
    cuisine ? `Cuisine: ${clean(cuisine, 30)}` : null,
    maxPrepMinutes ? `Time limit: ${Math.round(maxPrepMinutes)} minutes` : null,
    `AVAILABLE INGREDIENTS:\n${available.length ? available.join('\n') : '(none listed — propose pantry-only ideas)'}`,
    unresolved.length ? `USER MENTIONED BUT UNRESOLVED (do not rely on these):\n${unresolved.join(', ')}` : null,
    `\nUSER CONSTRAINTS:\n${constraintSummary(constraints)}`,
    constraints.unknown.length ? `UNVERIFIABLE — treat conservatively: ${constraints.unknown.map((u) => u.reason).slice(0, 5).join('; ')}` : null,
  ].filter(Boolean).join('\n');

  const meta = { generatorVersion: GENERATOR_VERSION, constraintVersion: constraints.version, retries: 0, providerCalls: 0 };

  let out;
  try {
    meta.providerCalls++;
    out = await callProvider(userId, promptText);
  } catch (e) {
    meta.providerError = { status: e.status || 500 };
    out = null;
  }

  let { usable, rejected } = out?.candidates?.length
    ? await validateAll(out.candidates, constraints, ctx)
    : { usable: [], rejected: [] };

  // Phase 8: ONE bounded correction attempt — feed failed ruleIds back so the
  // model can repair. Never retries an already-impossible combination more
  // than once.
  if (!usable.length && rejected.length && meta.providerCalls <= MAX_RETRIES && !meta.providerError) {
    meta.retries++;
    meta.providerCalls++;
    const correction = `${promptText}\n\nPREVIOUS ATTEMPT FAILED DETERMINISTIC VALIDATION.\nFailed rules: ${rejected.flatMap((r) => r.ruleIds).slice(0, 10).join(', ')}.\nReasons: ${rejected.flatMap((r) => (r.violations || []).map((x) => x.reason)).slice(0, 6).join(' | ')}.\nCorrect the recipes to satisfy these rules — do not drop user constraints.`;
    try {
      const retry = await callProvider(userId, correction);
      if (retry?.candidates?.length) {
        const r2 = await validateAll(retry.candidates, constraints, ctx);
        usable = usable.concat(r2.usable);
        rejected = rejected.concat(r2.rejected);
      }
    } catch (e) {
      meta.providerError = { status: e.status || 500 };
    }
  }

  // Fallback: an already-VERIFIED recipe that satisfies the same constraints
  // is better than nothing — reuse the matching path (constraints enforced).
  let fallback = [];
  if (!usable.length) {
    try {
      const matched = await matchIngredients({
        userId, items, diet, allergies, cuisine, maxPrepMinutes, servings, limit: 3,
      });
      fallback = matched.results.filter((r) => r.recipe.verificationLevel === 'VERIFIED' && r.status !== 'partial')
        .map((r) => ({ recipe: r.recipe, status: r.status, missingRequired: r.missingRequired, source: 'verified_fallback' }));
    } catch { /* fallback failure must not mask the primary outcome */ }
  }

  const status = usable.length
    ? (usable.every((u) => u.validation.status === 'PASS') ? 'ok' : 'needs_review')
    : fallback.length ? 'ok' : 'no_eligible_recipe';

  return {
    status,
    candidates: usable.slice(0, limit).map((u) => ({
      ...u.candidate,
      validation: { status: u.validation.status, violations: u.validation.violations, warnings: u.validation.warnings },
      nutrition: u.validation.nutrition,
      provenance: { source: 'ai_generated', reviewRequired: u.validation.status !== 'PASS', nutritionRecomputed: true },
    })),
    fallback,
    rejected,
    meta,
    ...(status === 'no_eligible_recipe' ? { reason: 'No recipe satisfied the hard constraints — restrictions were not relaxed.' } : {}),
  };
}

module.exports = { generateRecipes, GENERATOR_VERSION, CANDIDATE_PROPERTIES };
