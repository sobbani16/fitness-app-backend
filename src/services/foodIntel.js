// Food Intelligence service — barcode resolution, reviewed ingredient
// evidence, deterministic personalized suitability. No fabricated nutrients,
// no supplement-to-culinary overclaiming, hard exclusions always win.
const { getPrisma } = require('../lib/prisma');
const flags = require('./featureFlags/service');
const { LABEL_ANIMAL_TERMS } = require('./recipes/constraints');
// Lazy accessor — resolves getPrisma() per call so tests can swap the client.
const prisma = new Proxy({}, { get: (_t, prop) => getPrisma()[prop] });

// Reviewed educational profiles — written by hand, APPROVED on seed.
// Each claim: claim, verdict (established|mixed|insufficient|marketing),
// applicability, studyType, dose, limitations, source.
const EVIDENCE_SEED = [
  {
    ingredientKey: 'cinnamon', displayName: 'Cinnamon',
    summary: 'A common spice used in small culinary amounts. Contains coumarin in cassia varieties.',
    claims: [
      { claim: 'Causes weight loss', verdict: 'insufficient', applicability: 'None at culinary doses', studyType: 'mixed small trials', dose: 'Studies use 1-6g/day; sprinkled amounts are far lower', limitations: 'Short trials, small samples, inconsistent results', source: 'Systematic reviews of cinnamon and glycemia/adiposity trials' },
      { claim: 'Modest effect on fasting blood glucose in type 2 diabetes', verdict: 'mixed', applicability: 'Supplement doses in adults with T2D', studyType: 'meta-analyses of RCTs', dose: '1-6 g/day supplemental', limitations: 'Heterogeneous trials; effect size small and uncertain; not a treatment substitute', source: 'Cochrane-style reviews of cinnamon for diabetes' },
    ],
    cautions: [
      { text: 'Cassia cinnamon contains coumarin; large daily amounts may stress the liver.', appliesTo: 'People consuming large supplemental amounts' },
      { text: 'Culinary amounts in food are not equivalent to studied supplement doses.', appliesTo: 'All users' },
    ],
  },
  {
    ingredientKey: 'turmeric', displayName: 'Turmeric / curcumin',
    summary: 'Spice containing curcumin (~2-5% by weight). Culinary amounts deliver far less curcumin than studied supplements.',
    claims: [
      { claim: 'Treats inflammatory disease', verdict: 'insufficient', applicability: 'Supplement studies only; culinary use is not comparable', studyType: 'RCTs of curcumin extracts', dose: '500-2000 mg curcumin/day in studies vs ~50-100 mg in a curry', limitations: 'Poor curcumin bioavailability; many studies use enhanced formulations', source: 'Curcumin RCT literature in arthritis models' },
      { claim: 'May modestly reduce osteoarthritis symptoms at supplement doses', verdict: 'mixed', applicability: 'Supplement formulations', studyType: 'RCT meta-analyses', dose: '~1000 mg curcumin/day', limitations: 'Formulation-dependent; culinary turmeric cannot be assumed equivalent', source: 'Meta-analyses of curcumin for knee OA' },
    ],
    cautions: [
      { text: 'Do not treat culinary turmeric as a studied therapeutic dose.', appliesTo: 'All users' },
      { text: 'Supplement doses may interact with anticoagulants.', appliesTo: 'People on blood thinners' },
    ],
  },
  {
    ingredientKey: 'ginger', displayName: 'Ginger',
    summary: 'Widely used root spice. Studied mainly for nausea at gram-level doses.',
    claims: [
      { claim: 'Reduces nausea (pregnancy, motion sickness)', verdict: 'established', applicability: '~1 g/day doses; culinary use may approach this', studyType: 'multiple RCTs + meta-analyses', dose: '0.5-1.5 g/day', limitations: 'Mostly studied for specific nausea types, not general digestion', source: 'Meta-analyses of ginger for nausea and vomiting' },
      { claim: 'Boosts metabolism or burns fat', verdict: 'marketing', applicability: 'None', studyType: 'small trials', dose: 'n/a', limitations: 'Effects too small/inconsistent to matter for weight', source: 'Thermogenesis studies' },
    ],
    cautions: [{ text: 'High supplemental doses may interact with anticoagulants.', appliesTo: 'People on blood thinners' }],
  },
  {
    ingredientKey: 'oats', displayName: 'Oats / beta-glucan',
    summary: 'Whole grain rich in beta-glucan soluble fiber (~3-4 g per 40 g serving).',
    claims: [
      { claim: 'Lowers LDL cholesterol', verdict: 'established', applicability: 'At ≥3 g beta-glucan/day — roughly a daily bowl of oats', studyType: 'RCT meta-analyses; FDA/EFSA-authorized claim', dose: '≥3 g beta-glucan/day', limitations: 'Effect is modest (~5%); many oat products contain less fiber after processing', source: 'FDA/EFSA authorized health claim; meta-analyses' },
      { claim: 'Improves satiety', verdict: 'mixed', applicability: 'Whole oats more than instant/sugared products', studyType: 'small RCTs', dose: 'meal-level', limitations: 'Product formulation matters more than the grain itself', source: 'Satiety trials' },
    ],
    cautions: [{ text: 'Check added sugar in flavored oat products — it can exceed the grain\'s benefit.', appliesTo: 'Packaged oat products' }],
  },
  {
    ingredientKey: 'garlic', displayName: 'Garlic',
    summary: 'Allium vegetable used culinary and studied as aged/powdered extracts.',
    claims: [
      { claim: 'Modest blood-pressure reduction in hypertension', verdict: 'mixed', applicability: 'Supplement doses (600-2400 mg aged extract)', studyType: 'meta-analyses of RCTs', dose: 'supplement-level', limitations: 'Culinary amounts are far below studied doses', source: 'BP meta-analyses' },
      { claim: 'Lowers cholesterol significantly', verdict: 'insufficient', applicability: 'None established', studyType: 'mixed trials', dose: 'varies', limitations: 'Older positive trials contradicted by better-controlled ones', source: 'Cholesterol trial literature' },
    ],
    cautions: [{ text: 'Supplement doses may interact with anticoagulants and surgery.', appliesTo: 'People on blood thinners' }],
  },
  {
    ingredientKey: 'fenugreek', displayName: 'Fenugreek',
    summary: 'Legume seed/spice common in Indian cooking; soluble fiber rich.',
    claims: [
      { claim: 'Modest fasting glucose improvement in diabetes', verdict: 'mixed', applicability: 'Seed doses 5-25 g/day — far above seasoning amounts', studyType: 'small RCTs + meta-analyses', dose: '5-25 g/day seed powder', limitations: 'Small heterogeneous trials; culinary pinches are not comparable', source: 'Glycemic-control meta-analyses' },
    ],
    cautions: [
      { text: 'Can cause maple-syrup-like body odor at higher intakes.', appliesTo: 'Supplement users' },
      { text: 'May interact with anticoagulants; avoid large amounts in pregnancy.', appliesTo: 'Relevant users' },
    ],
  },
  {
    ingredientKey: 'flaxseed', displayName: 'Flaxseed',
    summary: 'Seed providing ALA omega-3 and lignans; must be ground for nutrient absorption.',
    claims: [
      { claim: 'Modest LDL reduction', verdict: 'mixed', applicability: 'Ground whole seed ~30 g/day', studyType: 'RCT meta-analyses', dose: '30 g/day ground', limitations: 'Whole unground seeds pass undigested; oil lacks fiber/lignans', source: 'Lipid meta-analyses' },
      { claim: 'Plant omega-3 replacement for fish', verdict: 'marketing', applicability: 'ALA converts poorly to EPA/DHA (<10%)', studyType: 'metabolic studies', dose: 'n/a', limitations: 'Conversion is limited; not equivalent to marine omega-3', source: 'ALA conversion literature' },
    ],
    cautions: [{ text: 'Use ground seed; store refrigerated to limit oxidation.', appliesTo: 'All users' }],
  },
  {
    ingredientKey: 'chia', displayName: 'Chia seeds',
    summary: 'Fiber- and ALA-rich seed (~10 g fiber per 28 g).',
    claims: [
      { claim: 'Weight loss aid', verdict: 'insufficient', applicability: 'None established', studyType: 'small RCTs', dose: '25-50 g/day studied', limitations: 'Trials show minimal weight effect despite marketing', source: 'Chia RCT literature' },
      { claim: 'Good fiber source', verdict: 'established', applicability: 'Nutritional composition, not a health outcome', studyType: 'composition data', dose: '~10 g fiber/28 g', limitations: 'n/a', source: 'USDA composition data' },
    ],
    cautions: [{ text: 'Dry seeds expand in liquid; swallow with adequate fluid.', appliesTo: 'All users' }],
  },
  {
    ingredientKey: 'yogurt', displayName: 'Yogurt / fermented dairy',
    summary: 'Fermented dairy providing protein, calcium; live cultures vary by product.',
    claims: [
      { claim: 'Supports gut health', verdict: 'mixed', applicability: 'Products with verified live cultures; strain-specific', studyType: 'varied', dose: 'daily servings', limitations: 'Not all products contain clinically studied probiotic strains; "fermented" ≠ "probiotic"', source: 'ISAPP consensus on fermented foods vs probiotics' },
      { claim: 'Good protein and calcium source', verdict: 'established', applicability: 'Plain yogurt especially', studyType: 'composition data', dose: 'per serving', limitations: 'Flavored products may add substantial sugar', source: 'USDA composition data' },
    ],
    cautions: [{ text: 'Check added sugar — flavored yogurts can rival desserts.', appliesTo: 'Flavored products' }],
  },
  {
    ingredientKey: 'fiber', displayName: 'Dietary fiber',
    summary: 'Non-digestible carbohydrate; target ~25-38 g/day for adults.',
    claims: [
      { claim: 'Supports regularity, glycemic control, modest LDL reduction', verdict: 'established', applicability: 'General population at adequate intake', studyType: 'strong observational + RCT support', dose: '25-38 g/day', limitations: 'Increase gradually with fluids', source: 'DGA/EFSA guidance, meta-analyses' },
    ],
    cautions: [{ text: 'Sudden large increases can cause bloating — ramp up gradually.', appliesTo: 'All users' }],
  },
];

async function ensureEvidenceSeeded() {
  const count = await prisma.ingredientEvidenceProfile.count();
  if (count > 0) return;
  for (const p of EVIDENCE_SEED) {
    await prisma.ingredientEvidenceProfile.upsert({
      where: { ingredientKey_version: { ingredientKey: p.ingredientKey, version: 1 } },
      create: { ...p, status: 'APPROVED', reviewedBy: 'humai-editorial', reviewedAt: new Date() },
      update: {},
    });
  }
}

// --- Barcode resolution --------------------------------------------------------

async function resolveBarcode(barcode) {
  const code = String(barcode || '').replace(/\D/g, '');
  if (!code) { const e = new Error('barcode required'); e.status = 400; throw e; }
  const product = await prisma.barcodeProduct.findUnique({ where: { barcode: code } });
  if (product) return { found: true, barcode: code, product, verified: product.source === 'catalog' };
  const ext = await fetchOpenFoodFacts(code);
  if (ext) {
    // Cache community-sourced rows so repeat scans are local and auditable;
    // source 'openfoodfacts' keeps verified=false and preserves provenance.
    const row = { barcode: code, name: ext.name, brand: ext.brand, servingSizeG: ext.servingSizeG, servingLabel: ext.servingLabel, nutrients: { ...ext.nutrients, packageQuantityG: ext.packageQuantityG, servingSizeMl: ext.servingSizeMl ?? null, servingUnit: ext.servingUnit ?? 'unknown', retrievedAt: new Date().toISOString() }, ingredients: ext.ingredients, allergens: ext.allergens, source: 'openfoodfacts' };
    try { await prisma.barcodeProduct.upsert({ where: { barcode: code }, create: row, update: { name: row.name, brand: row.brand, servingSizeG: row.servingSizeG, servingLabel: row.servingLabel, nutrients: row.nutrients, ingredients: row.ingredients, allergens: row.allergens } }); } catch { /* cache miss is non-fatal */ }
    return { found: true, barcode: code, product: ext, verified: false, externalSource: 'openfoodfacts', dataQuality: 'community' };
  }
  return { found: false, barcode: code, nextStep: 'label_photo_or_manual' };
}

// Parse a manufacturer serving declaration into mass vs volume. OFF's
// `serving_quantity` is a number in the product's declared unit — "330" next
// to a "330 ml" label is milliliters, NOT grams. Mass is only ever stored
// when the label declares a mass unit; volume declarations keep their unit
// so downstream never fabricates 1 ml = 1 g.
const VOLUME_RE = /(\d+(?:\.\d+)?)\s*(ml|millilitre?s?|cl|dl|litres?|liters?|l)\b/i;
const FL_OZ_RE = /(\d+(?:\.\d+)?)\s*(fl\.?\s?oz|fluid\s?ounces?)\b/i;
const MASS_RE = /(\d+(?:\.\d+)?)\s*(g|grams?|kg|kgs)\b/i;
function parseServingDeclaration(servingSizeText, servingQuantity) {
  const text = String(servingSizeText || '');
  const qty = Number(servingQuantity);
  const vol = text.match(VOLUME_RE) || text.match(FL_OZ_RE);
  if (vol) {
    const amount = vol[2].toLowerCase().startsWith('fl') || /fluid/i.test(vol[2])
      ? Math.round(Number(vol[1]) * 29.5735 * 100) / 100          // US fl oz → ml (approximate — recorded as derived)
      : Number(vol[1]) * ({ cl: 10, dl: 100, l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000 }[vol[2].toLowerCase()] || 1);
    return { unit: 'ml', amountMl: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : (Number.isFinite(qty) ? qty : null), amountG: null };
  }
  const mass = text.match(MASS_RE);
  if (mass) {
    const g = mass[2].toLowerCase().startsWith('kg') ? Number(mass[1]) * 1000 : Number(mass[1]);
    return { unit: 'g', amountMl: null, amountG: Number.isFinite(g) ? g : (Number.isFinite(qty) ? qty : null) };
  }
  // No unit in the label text — serving_quantity is ambiguous; never guess.
  return { unit: 'unknown', amountMl: null, amountG: null };
}

// Authorized external fallback — Open Food Facts (ODbL). Community data is NEVER
// treated as verified; provenance + retrieval date are preserved. Failures
// degrade gracefully to the manual path. Disabled via flag → returns null.
async function fetchOpenFoodFacts(code) {
  const on = await flags.isEnabled('food_external_catalog_enabled', null).catch(() => false);
  if (!on || typeof fetch !== 'function') return null;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,serving_size,serving_quantity,product_quantity,nutriments,ingredients_text,allergens_tags`, { signal: ctrl.signal, headers: { 'User-Agent': 'HumaiFitness/1.0 (contact: dev@humai.app)' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const p = j?.product; if (!p?.product_name) return null;
    const n = p.nutriments || {};
    // serving_quantity is a number in the label's declared unit — classify
    // before trusting it as mass. Volume servings keep unit + ml only.
    const decl = parseServingDeclaration(p.serving_size, p.serving_quantity);
    const servingG = decl.unit === 'g' ? decl.amountG : null;
    return { barcode: code, name: String(p.product_name).slice(0, 200), brand: p.brands || null,
      servingSizeG: Number.isFinite(servingG) && servingG > 0 && servingG <= 5000 ? servingG : null,
      servingSizeMl: decl.unit === 'ml' && Number.isFinite(decl.amountMl) && decl.amountMl > 0 && decl.amountMl <= 5000 ? decl.amountMl : null,
      servingUnit: decl.unit,
      servingLabel: p.serving_size || null, packageQuantityG: Number(p.product_quantity) || null,
      nutrients: { calories: n['energy-kcal_serving'] ?? null, proteinG: n.proteins_serving ?? null, carbsG: n.carbohydrates_serving ?? null, fatG: n.fat_serving ?? null, fiberG: n.fiber_serving ?? null, sugarG: n.sugars_serving ?? null, sodiumMg: n.sodium_serving != null ? n.sodium_serving * 1000 : null },
      ingredients: p.ingredients_text || null, allergens: (p.allergens_tags || []).map(a => String(a).replace('en:', '')), source: 'openfoodfacts' };
  } catch { return null; }
}

// User correction — records provenance (field-level audit) then applies the
// correction to the shared catalog row marked source='user'.
const CORRECTABLE = ['name', 'brand', 'servingSizeG', 'servingLabel', 'ingredients'];
async function correctProduct(userId, barcode, { field, value }) {
  const code = String(barcode || '').replace(/\D/g, '');
  if (!code || !CORRECTABLE.includes(field) || value == null) { const e = new Error(`field must be one of ${CORRECTABLE.join('|')} with a value`); e.status = 400; throw e; }
  const product = await prisma.barcodeProduct.findUnique({ where: { barcode: code } });
  if (!product) { const e = new Error('unknown barcode — create it first'); e.status = 404; throw e; }
  const newValue = field === 'servingSizeG' ? String(Number(value)) : String(value).slice(0, 500);
  if (field === 'servingSizeG' && (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 5000)) { const e = new Error('servingSizeG must be 1-5000'); e.status = 400; throw e; }
  await prisma.productCorrection.create({ data: { userId, barcode: code, field, oldValue: product[field] != null ? String(product[field]) : null, newValue } });
  return prisma.barcodeProduct.update({ where: { barcode: code }, data: { [field]: field === 'servingSizeG' ? Number(newValue) : newValue, source: 'user' } });
}

async function toggleFavorite(userId, barcode) {
  const code = String(barcode || '').replace(/\D/g, '');
  if (!code) { const e = new Error('barcode required'); e.status = 400; throw e; }
  const existing = await prisma.barcodeFavorite.findUnique({ where: { userId_barcode: { userId, barcode: code } } });
  if (existing) { await prisma.barcodeFavorite.delete({ where: { id: existing.id } }); return { favorite: false }; }
  await prisma.barcodeFavorite.create({ data: { userId, barcode: code } });
  return { favorite: true };
}

async function listFavorites(userId) {
  const favs = await prisma.barcodeFavorite.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const products = await prisma.barcodeProduct.findMany({ where: { barcode: { in: favs.map(f => f.barcode) } } });
  const byCode = new Map(products.map(p => [p.barcode, p]));
  return favs.map(f => ({ barcode: f.barcode, product: byCode.get(f.barcode) || null }));
}

async function upsertBarcodeProduct(userId, body) {
  const code = String(body.barcode || '').replace(/\D/g, '');
  if (!code || !body.name) { const e = new Error('barcode and name required'); e.status = 400; throw e; }
  return prisma.barcodeProduct.upsert({
    where: { barcode: code },
    create: { barcode: code, name: body.name, brand: body.brand, servingSizeG: body.servingSizeG, servingLabel: body.servingLabel, nutrients: body.nutrients || {}, ingredients: body.ingredients, allergens: body.allergens || [], source: 'user' },
    update: { name: body.name, brand: body.brand, servingSizeG: body.servingSizeG, servingLabel: body.servingLabel, nutrients: body.nutrients, ingredients: body.ingredients, allergens: body.allergens, source: 'user' },
  });
}

// --- Evidence -----------------------------------------------------------------

// Indian + common aliases → canonical keys (India-first readiness D3)
const ALIASES = { haldi: 'turmeric', dalchini: 'cinnamon', 'dal chini': 'cinnamon', adrak: 'ginger', adarak: 'ginger', methi: 'fenugreek', alsi: 'flaxseed', 'flax seed': 'flaxseed', dahi: 'yogurt', curd: 'yogurt', jai: 'oats', 'rolled oats': 'oats', lahsun: 'garlic', 'chia seed': 'chia', sabja: 'chia' };

async function getEvidence(ingredientKey) {
  await ensureEvidenceSeeded();
  const raw = String(ingredientKey).toLowerCase().trim();
  const profile = await prisma.ingredientEvidenceProfile.findFirst({
    where: { ingredientKey: ALIASES[raw] || raw, status: { in: ['APPROVED', 'ACTIVE'] } },
    orderBy: { version: 'desc' },
  });
  if (!profile) return { found: false, ingredientKey: raw, canonical: ALIASES[raw] || raw };
  return {
    found: true, ingredientKey: profile.ingredientKey, displayName: profile.displayName,
    summary: profile.summary, claims: profile.claims, cautions: profile.cautions,
    version: profile.version, status: profile.status, reviewedAt: profile.reviewedAt,
    attribution: 'Reviewed educational content. Not medical advice.',
  };
}

async function listEvidence() {
  await ensureEvidenceSeeded();
  return prisma.ingredientEvidenceProfile.findMany({ where: { status: { in: ['APPROVED', 'ACTIVE'] } }, select: { ingredientKey: true, displayName: true, summary: true } });
}

// --- Personalized suitability (deterministic — hard exclusions always win) ------

async function checkSuitability(userId, { ingredientKeys = [], allergens = [], ingredientText = null }) {
  const result = { verdict: 'suitable', reasons: [], unknowns: [] };
  if (!ingredientKeys.length && !ingredientText && !allergens.length) {
    return { verdict: 'unknown', reasons: [], unknowns: ['Ingredient composition not available — suitability cannot be determined.'] };
  }
  const text = (ingredientText || ingredientKeys.join(' ')).toLowerCase();
  const { keywordsFor, RESTRICTION_KEYWORDS } = require('./mealSuggestion');
  const has = (term) => text.includes(term) || allergens.map((x) => x.toLowerCase()).includes(term);

  // Allergies — hard exclusion. Allergy names expand via the canonical
  // keyword map (peanut → peanut, groundnut, ...) so custom names still match.
  const allergies = await prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } });
  for (const a of allergies) {
    const name = a.allergy?.name;
    if (!name) continue;
    if (keywordsFor(name).some(has)) {
      result.verdict = 'conflict';
      result.reasons.push({ type: 'allergy', severity: 'hard', message: `Contains or may contain ${name}, which you listed as an allergy.` });
    }
  }

  // Dietary restrictions — hard exclusions via the canonical restriction map
  const planning = await prisma.userPlanningPreferences.findUnique({ where: { userId } }).catch(() => null);
  // Animal-derived additives that appear on labels but not in meal names —
  // LABEL_ANIMAL_TERMS is shared with the recipe-constraint module.

  for (const r of planning?.dietaryRestrictions || []) {
    const key = String(r).toLowerCase().replace(/[\s-]+/g, '_');
    let words = RESTRICTION_KEYWORDS[key] || [key.replace(/_/g, ' ')];
    if (['vegetarian', 'vegan', 'eggetarian', 'pescatarian'].includes(key)) words = [...words, ...LABEL_ANIMAL_TERMS];
    if (key === 'jain' || key === 'halal' || key === 'kosher') words = [...words, ...LABEL_ANIMAL_TERMS];
    const hit = words.find(has);
    if (hit) {
      result.verdict = 'conflict';
      result.reasons.push({ type: 'diet', severity: 'hard', message: `Contains ${hit} — conflicts with your ${r.replace(/_/g, ' ')} restriction.` });
    }
  }

  // Food preferences: NEVER_RECOMMEND = hard exclusion, DISLIKE = soft caution
  const prefs = await prisma.foodPreference.findMany({ where: { userId, preference: { in: ['DISLIKE', 'NEVER_RECOMMEND'] } } }).catch(() => []);
  for (const p of prefs) {
    const n = String(p.foodName || '').toLowerCase();
    if (!n || !text.includes(n)) continue;
    if (p.preference === 'NEVER_RECOMMEND') {
      result.verdict = 'conflict';
      result.reasons.push({ type: 'exclusion', severity: 'hard', message: `Contains ${p.foodName}, which you marked as never recommend.` });
    } else {
      result.reasons.push({ type: 'dislike', severity: 'soft', message: `Contains ${p.foodName}, which you listed as a dislike.` });
    }
  }

  // Clinician-set meat exclusions on health conditions (name-matched)
  const conditions = await prisma.userHealthCondition.findMany({ where: { userId }, include: { condition: true } }).catch(() => []);
  for (const c of conditions) {
    const cname = (c.condition?.name || '').toLowerCase();
    if (/beef|pork|red meat/.test(cname)) {
      const terms = cname.includes('beef') ? ['beef'] : cname.includes('pork') ? ['pork', 'lard'] : ['beef', 'pork', 'red meat'];
      const hit = terms.find(has);
      if (hit) { result.verdict = 'conflict'; result.reasons.push({ type: 'condition', severity: 'hard', message: `Contains ${hit} — conflicts with your ${c.condition?.name || 'dietary'} restriction.` }); }
    }
    if (/hypertension|blood pressure/.test(cname) && !ingredientText) {
      result.unknowns.push('Sodium content unavailable — check the nutrition panel if managing blood pressure.');
    }
  }

  if (result.verdict === 'suitable' && result.reasons.some((r) => r.severity === 'soft')) result.verdict = 'caution';
  if (!ingredientText && !allergens.length) {
    result.unknowns.push('Full ingredient list unavailable — verify the label for hidden ingredients.');
    if (result.verdict === 'suitable') result.verdict = 'unknown';
  }
  return result;
}

// Nutrients stored on BarcodeProduct carry provenance keys (retrievedAt,
// packageQuantityG) alongside real values. Consumers must only ever see the
// nutrient map — provenance lives on the product/snapshot itself.
const NUTRIENT_KEYS = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'sodiumMg'];
const pickNutrients = (n) => Object.fromEntries(NUTRIENT_KEYS.filter((k) => k in (n || {})).map((k) => [k, n[k]]));

// Compose the scan result view-model the screen renders.
async function scanResult(userId, { barcode, ingredientKeys = [], ingredientText, nutrients, allergens = [], productName }) {
  const out = { product: null, nutrition: null, ingredients: [], evidence: [], suitability: null, provenance: {} };
  if (barcode) {
    const r = await resolveBarcode(barcode);
    if (r.found) {
      // Surface serving-unit metadata from cache meta or the fresh lookup so
      // clients can distinguish declared mass from declared volume.
      const meta = r.product.nutrients || {};
      out.product = { ...r.product,
        servingSizeMl: r.product.servingSizeMl ?? meta.servingSizeMl ?? null,
        servingUnit: r.product.servingUnit ?? meta.servingUnit ?? (r.product.servingSizeG ? 'g' : 'unknown') };
      out.nutrition = { source: r.product.source, verified: r.verified, per: r.product.servingLabel || `${r.product.servingSizeG || 100}g`, values: pickNutrients(r.product.nutrients) };
      ingredientText = ingredientText || r.product.ingredients;
      allergens = allergens.length ? allergens : (r.product.allergens || []);
      ingredientKeys = ingredientKeys.length ? ingredientKeys : EVIDENCE_SEED.map((s) => s.ingredientKey).filter((k) => (r.product.ingredients || '').toLowerCase().includes(k));
    }
    out.provenance.barcode = r.found ? 'match' : 'unknown';
  }
  for (const k of ingredientKeys) {
    const ev = await getEvidence(k);
    if (ev.found) out.evidence.push({ ingredientKey: k, displayName: ev.displayName, summary: ev.summary, claims: ev.claims, cautions: ev.cautions });
  }
  out.suitability = await checkSuitability(userId, { ingredientKeys, allergens, ingredientText });
  if (!out.nutrition && nutrients) out.nutrition = { source: 'label', verified: false, values: nutrients };
  out.disclaimer = 'Nutrition and suitability are estimates based on available data. Verify the product label.';
  return out;
}

// Deterministic, evidence-bounded explanation for Leo — template-built from
// approved claims only; never invents citations.
async function explainIngredient(ingredientKey, question) {
  const ev = await getEvidence(ingredientKey);
  if (!ev.found) return { found: false, message: `I don't have a reviewed evidence profile for "${ingredientKey}" yet.`, citations: [] };
  const q = String(question || '').toLowerCase();
  const claims = ev.claims;
  const relevant = q ? claims.filter((c) => c.claim.toLowerCase().split(/\s+/).some((w) => w.length > 3 && q.includes(w))) : claims;
  const use = relevant.length ? relevant : claims;
  const parts = use.map((c) => {
    const verdict = { established: 'Supported by evidence', mixed: 'Evidence is mixed', insufficient: 'Not supported by current evidence', marketing: 'Mostly a marketing claim' }[c.verdict] || c.verdict;
    return `${verdict}: ${c.claim}. ${c.applicability}${c.limitations ? ` (${c.limitations})` : ''}`;
  });
  const cautions = ev.cautions.map((c) => c.text);
  return {
    found: true, ingredient: ev.displayName, summary: ev.summary, answer: parts,
    cautions, version: ev.version,
    citations: use.map((c) => c.source).filter(Boolean),
    disclaimer: 'Educational summary from reviewed evidence records — not medical advice.',
  };
}

// Explainable alternatives — same catalog category, hard restrictions applied
// first, honest "why" strings. Never calls anything medically safe.
async function alternatives(userId, { ingredientText = '', category, limit = 5 }) {
  const suit = await checkSuitability(userId, { ingredientText });
  const blocked = suit.verdict === 'conflict';
  const candidates = await prisma.ingredientCatalog.findMany({
    where: category ? { foodType: category } : {},
    take: 60, orderBy: { name: 'asc' },
    select: { name: true, foodType: true, cuisine: true },
  }).catch(() => []);
  const out = [];
  const { RESTRICTION_KEYWORDS, keywordsFor } = require('./mealSuggestion');
  for (const c of candidates) {
    if (out.length >= limit) break;
    const n = String(c.name || '').toLowerCase();
    if (!n || (ingredientText && ingredientText.toLowerCase().includes(n))) continue;
    // quick deterministic re-check of the candidate against user restrictions
    const cSuit = await checkSuitability(userId, { ingredientText: n });
    if (cSuit.verdict === 'conflict') continue;
    out.push({ name: c.name, category: c.foodType, cuisine: c.cuisine, why: cSuit.verdict === 'suitable' ? 'No conflicts with your saved preferences' : 'Verify the label before choosing', verdict: cSuit.verdict });
  }
  return { alternatives: out, note: blocked ? 'Alternatives avoid the conflict found in the scanned item.' : 'Similar-category options from the catalog.', disclaimer: 'Suggestions are filtered by your restrictions — always verify labels.' };
}

// Add-to-log through the existing FoodLog pipeline with source provenance.
async function logScannedFood(userId, { productName, servingG, servingLabel, servingVolumeMl, servingUnit, massSource, nutrients = {}, mealType = 'meal', barcode, servingSizeMl }) {
  const volMlIn = Number.isFinite(Number(servingVolumeMl)) && Number(servingVolumeMl) > 0 && Number(servingVolumeMl) <= 5000 ? Number(servingVolumeMl) : null;
  const hasG = Number.isFinite(Number(servingG)) && Number(servingG) > 0 && Number(servingG) <= 5000;
  if (!productName || (!hasG && !volMlIn)) {
    const e = new Error('productName and servingG (1-5000) or servingVolumeMl required'); e.status = 400; throw e;
  }

  // Volume-native path: a serving declared in milliliters whose nutrition was
  // declared FOR THAT VOLUME serving is legitimate per-volume evidence — the
  // manufacturer told us the nutrition of a volume-quantified serving, so no
  // mass conversion is ever needed. Mass stays honestly null. Without that
  // evidence (e.g. nutrition declared per 100 g only) a volume log would
  // fabricate nutrition — rejected with zero writes.
  if (!hasG) {
    let unit = servingUnit, refMl = Number.isFinite(Number(servingSizeMl)) ? Number(servingSizeMl) : null, perServing = pickNutrients(nutrients), derivedFrom = 'client';
    if (barcode) {
      const code = String(barcode).replace(/\D/g, '');
      const row = await prisma.barcodeProduct.findUnique({ where: { barcode: code } }).catch(() => null);
      if (row) {
        // Provenance flows from the cached lookup row — never client-asserted.
        const meta = row.nutrients || {};
        unit = meta.servingUnit ?? row.servingUnit ?? unit;
        refMl = Number.isFinite(Number(meta.servingSizeMl ?? row.servingSizeMl)) ? Number(meta.servingSizeMl ?? row.servingSizeMl) : refMl;
        perServing = pickNutrients(meta);
        derivedFrom = 'barcode-cache';
      }
    }
    const volumeDeclared = unit === 'ml' && Number.isFinite(refMl) && refMl > 0 && Number.isFinite(perServing.calories);
    if (!volumeDeclared) {
      const e = new Error('volume_nutrition_basis_required'); e.status = 400; throw e;
    }
    const factor = volMlIn / refMl;
    const scaled = Object.fromEntries(Object.entries(perServing).map(([k, v]) => [k, Number.isFinite(v) ? Math.round(v * factor * 100) / 100 : v]));
    const saved = await prisma.foodLog.create({ data: {
      userId, foodName: String(productName).slice(0, 300), quantityG: null,
      quantityMl: volMlIn, quantityUnit: 'ml',
      calories: scaled.calories ?? 0, proteinG: scaled.proteinG ?? 0, carbsG: scaled.carbsG ?? 0,
      fatG: scaled.fatG ?? 0, fiberG: scaled.fiberG ?? null,
      mealType: String(mealType).slice(0, 30),
      nutritionSnapshot: { loggedSource: 'food-intel', barcode: barcode || null, perServing, reviewRecommended: !barcode,
        nutrientUnknowns: require('./nutrientCompleteness').computeUnknowns(scaled),
        selectedServing: typeof servingLabel === 'string' && servingLabel.trim() ? servingLabel.slice(0, 200) : null,
        servingGrams: null, servingCount: Math.round(factor * 1000) / 1000,
        // The nutrition basis is honestly per-volume: the label declared
        // nutrition for a volume-quantified serving. Never a mass conversion.
        nutritionBasis: 'PER_100_ML',
        basisEvidence: 'manufacturer-volume-serving-declaration',
        basisDerivedFrom: derivedFrom,
        declaredServingMl: refMl,
        servingVolumeMl: volMlIn,
        servingUnit: 'ml',
        massSource: null },
    } });
    return saved;
  }

  const g = Number(servingG);
  const volMl = volMlIn;
  // nutrient values are per serving — scale by grams relative to serving size.
  // Restrict to the known nutrient map so client/provenance keys can't leak
  // into perServing snapshots or be mistaken for nutrients.
  const n = pickNutrients(nutrients);
  const saved = await prisma.foodLog.create({ data: {
    userId, foodName: String(productName).slice(0, 300), quantityG: g,
    calories: n.calories ?? 0, proteinG: n.proteinG ?? 0, carbsG: n.carbsG ?? 0,
    fatG: n.fatG ?? 0, fiberG: n.fiberG ?? null,
    mealType: String(mealType).slice(0, 30),
    nutritionSnapshot: { loggedSource: 'food-intel', barcode: barcode || null, perServing: n, reviewRecommended: !barcode,
      nutrientUnknowns: require('./nutrientCompleteness').computeUnknowns(n),
      selectedServing: typeof servingLabel === 'string' && servingLabel.trim() ? servingLabel.slice(0, 200) : null,
      servingGrams: g, servingCount: 1,
      // Mass provenance: 'manufacturer' when the label declared grams;
      // 'user-entered' when the user supplied a weighed/labeled mass for a
      // volume-declared product. Never a silent ml→g conversion.
      servingVolumeMl: volMl,
      servingUnit: ['g', 'ml', 'unknown'].includes(servingUnit) ? servingUnit : null,
      massSource: ['manufacturer', 'user-entered'].includes(massSource) ? massSource : null },
  } });
  return saved;
}

module.exports = {
  correctProduct, toggleFavorite, listFavorites, EVIDENCE_SEED, ensureEvidenceSeeded, resolveBarcode, upsertBarcodeProduct, getEvidence, listEvidence, checkSuitability, scanResult, explainIngredient, alternatives, logScannedFood, parseServingDeclaration, ALIASES };
