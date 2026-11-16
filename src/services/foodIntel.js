// Food Intelligence service — barcode resolution, reviewed ingredient
// evidence, deterministic personalized suitability. No fabricated nutrients,
// no supplement-to-culinary overclaiming, hard exclusions always win.
const prisma = require('../lib/prisma');

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
  if (!product) return { found: false, barcode: code, nextStep: 'label_photo_or_manual' };
  return { found: true, barcode: code, product, verified: product.source === 'catalog' };
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

async function getEvidence(ingredientKey) {
  await ensureEvidenceSeeded();
  const profile = await prisma.ingredientEvidenceProfile.findFirst({
    where: { ingredientKey: String(ingredientKey).toLowerCase(), status: { in: ['APPROVED', 'ACTIVE'] } },
    orderBy: { version: 'desc' },
  });
  if (!profile) return { found: false, ingredientKey };
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
  // supplement the canonical restriction map for label scanning only.
  const LABEL_ANIMAL_TERMS = ['gelatin', 'gelatine', 'lard', 'tallow', 'carmine', 'cochineal', 'isinglass', 'rennet'];
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

// Compose the scan result view-model the screen renders.
async function scanResult(userId, { barcode, ingredientKeys = [], ingredientText, nutrients, allergens = [], productName }) {
  const out = { product: null, nutrition: null, ingredients: [], evidence: [], suitability: null, provenance: {} };
  if (barcode) {
    const r = await resolveBarcode(barcode);
    if (r.found) {
      out.product = r.product;
      out.nutrition = { source: r.product.source, verified: r.verified, per: r.product.servingLabel || `${r.product.servingSizeG || 100}g`, values: r.product.nutrients };
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

module.exports = { EVIDENCE_SEED, ensureEvidenceSeeded, resolveBarcode, upsertBarcodeProduct, getEvidence, listEvidence, checkSuitability, scanResult };
