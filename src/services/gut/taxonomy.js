// Canonical gut-taxonomy classification (ISAPP-aligned).
//
// One deterministic classifier for every gut-relevant claim about a food:
//   - fermentation during preparation
//   - heat treatment at consumption
//   - live-culture presence
//   - probiotic (strain-specific demonstrated benefit)
//   - prebiotic-containing / validated prebiotic
//   - resistant starch
//   - synbiotic / postbiotic (verified only — never inferred)
//
// Evidence ladder, strictest first:
//   1. IngredientAttribute rows  — reviewed metadata, can assert 'verified'.
//   2. IngredientCatalog.category — catalog-level facts (e.g. 'fermented').
//   3. Name/preparation heuristics — can only ever assert 'suspected'.
//   4. Otherwise 'unknown'.
//
// Name heuristics NEVER produce 'verified': a food is not verified fermented
// because its name contains a fermented-sounding word, and never 'probiotic'
// by name alone. ISAPP: fermented ≠ live-culture ≠ probiotic — the levels
// are kept separate so a caller cannot collapse them.
//
// Vinegar-acidified pickles are deliberately unmatched: 'pickle' resolves to
// unknown, not fermented, because the name cannot distinguish lacto-ferment
// from acidification. Cooked rice is only 'suspected fermented' through the
// documented fermented-rice dish names, never plain rice.

const LEVELS = {
  fermentation: ['verified', 'suspected', 'none', 'unknown'],
  heatTreatment: ['heat_treated', 'unheated', 'unknown'],
  liveCultures: ['verified', 'unlikely_heat_treated', 'unknown', 'none'],
  probiotic: ['verified', 'not_verified', 'unknown'],
  prebiotic: ['verified', 'containing', 'none', 'unknown'],
  resistantStarch: ['verified', 'suspected', 'unknown'],
  synbiotic: ['verified', 'unknown'],
  postbiotic: ['verified', 'unknown'],
};

// Reviewed metadata attributes (IngredientAttribute.attribute). These are the
// canonical carriers once scientific review attaches them to ingredients.
const ATTR_FERMENTED = 'FERMENTED';
const ATTR_LIVE_CULTURES = 'FERMENTED_LIVE_CULTURES';
const ATTR_HEAT_TREATED = 'FERMENTED_HEAT_TREATED';
const ATTR_PROBIOTIC = 'PROBIOTIC_VERIFIED';
const ATTR_PREBIOTIC = 'PREBIOTIC_CONTAINING';
const ATTR_RESISTANT_STARCH = 'RESISTANT_STARCH';
const ATTR_SYNBIOTIC = 'SYNBIOTIC_VERIFIED';
const ATTR_POSTBIOTIC = 'POSTBIOTIC_VERIFIED';
const PREBIOTIC_SUBSTRATE_RE = /^PREBIOTIC_(INULIN|FOS|GOS|BETA_GLUCAN|PECTIN|RESISTANT_STARCH|ARABINOXYLAN)$/;

// Name heuristics — 'suspected' ceiling. Terms are whole-word matched on the
// lowercased logged food name (the user's own description), NOT on catalog
// identity; catalog facts come through catalog.category instead.
const FERMENTED_UNHEATED_RE = /\b(dahi|perugu|curd|yogh?urt|kefir|chaas|chach|majjiga|buttermilk|lassi|kanji|kimchi|sauerkraut|natto|miso|tempeh|kombucha|gundruk|sinki|kinema|axone|hawaijar|tungrymbai|bekang|pakhala(?:\s+bhata)?|pazhaya\s+sadam|bore\s+baasi|poita\s+bhat)\b/i;
// Fermented batter/dough that is cooked before eating — live cultures
// thermally destroyed or severely reduced; fermentation still counts as a
// preparation fact, live-culture benefit does not.
const FERMENTED_THEN_COOKED_RE = /\b(idli|dosa|dhokla|handvo|appam|sourdough)\b/i;
// Explicit non-fermented variants of the above — 'instant/quick/ready-mix'
// idli or dosa is acid- or soda-leavened, not fermented. Suppresses the
// cooked-fermentation heuristic for that name.
const NON_FERMENTED_PREP_RE = /\b(instant|quick[- ]?mix|ready[- ]?to[- ]?(?:cook|eat)|non[- ]?fermented)\b/i;

function emptyClassification(basis) {
  return {
    fermentation: 'unknown',
    heatTreatment: 'unknown',
    liveCultures: 'unknown',
    probiotic: 'unknown',
    prebiotic: 'unknown',
    prebioticSubstrates: [],
    resistantStarch: 'unknown',
    synbiotic: 'unknown',
    postbiotic: 'unknown',
    basis,
  };
}

/**
 * Classify one logged food.
 * @param {object} input
 * @param {string} [input.foodName]    logged food name (free text)
 * @param {object} [input.catalog]     IngredientCatalog row (needs category, preparation)
 * @param {string[]} [input.attributes] IngredientAttribute.attribute strings
 */
function classifyGutFood({ foodName = '', catalog = null, attributes = [] } = {}) {
  const c = emptyClassification('none');
  const attrs = new Set((attributes || []).map((a) => String(a || '').toUpperCase()));

  // 1. Reviewed metadata — the only tier allowed to assert 'verified'.
  if (attrs.size) {
    c.basis = 'ingredient_attribute';
    if (attrs.has(ATTR_FERMENTED)) c.fermentation = 'verified';
    if (attrs.has(ATTR_HEAT_TREATED)) { c.fermentation = 'verified'; c.heatTreatment = 'heat_treated'; c.liveCultures = 'unlikely_heat_treated'; }
    if (attrs.has(ATTR_LIVE_CULTURES)) { c.fermentation = 'verified'; c.liveCultures = 'verified'; }
    if (attrs.has(ATTR_PROBIOTIC)) { c.probiotic = 'verified'; c.liveCultures = 'verified'; }
    for (const a of attrs) {
      const m = a.match(PREBIOTIC_SUBSTRATE_RE);
      if (m) { c.prebiotic = 'verified'; c.prebioticSubstrates.push(m[1].toLowerCase()); }
    }
    if (attrs.has(ATTR_PREBIOTIC) && c.prebiotic === 'unknown') c.prebiotic = 'containing';
    if (attrs.has(ATTR_RESISTANT_STARCH)) c.resistantStarch = 'verified';
    if (attrs.has(ATTR_SYNBIOTIC)) c.synbiotic = 'verified';
    if (attrs.has(ATTR_POSTBIOTIC)) c.postbiotic = 'verified';
  }

  // 2. Catalog-level facts — 'fermented' is a real catalog category in Humai.
  //    It establishes fermentation, NOT live-culture viability.
  if (String(catalog?.category || '').toLowerCase() === 'fermented') {
    c.fermentation = 'verified';
    if (c.basis === 'none') c.basis = 'catalog_category';
  }

  // 3. Name heuristics — suspected ceiling, and only where higher tiers
  //    have not already classified the facet.
  const name = String(foodName || '');
  if (c.fermentation === 'unknown') {
    if (FERMENTED_UNHEATED_RE.test(name)) {
      c.fermentation = 'suspected';
      if (c.heatTreatment === 'unknown') c.heatTreatment = 'unheated';
      if (c.basis === 'none') c.basis = 'name_heuristic';
    } else if (FERMENTED_THEN_COOKED_RE.test(name) && !NON_FERMENTED_PREP_RE.test(name)) {
      c.fermentation = 'suspected';
      c.heatTreatment = 'heat_treated';
      if (c.liveCultures === 'unknown') c.liveCultures = 'unlikely_heat_treated';
      if (c.basis === 'none') c.basis = 'name_heuristic';
    }
  }

  // Probiotic is never 'suspected' — it stays 'unknown' without verified
  // strain-level metadata, even when live cultures are verified. That is the
  // ISAPP distinction: live microorganisms ≠ demonstrated benefit.
  return c;
}

/** Facets worth counting as eating occasions on the gut dashboard. */
function gutFacetsOf(cls) {
  const f = [];
  if (cls.fermentation === 'verified' || cls.fermentation === 'suspected') f.push('fermented');
  if (cls.liveCultures === 'verified') f.push('live_culture');
  if (cls.probiotic === 'verified') f.push('probiotic');
  if (cls.prebiotic === 'verified' || cls.prebiotic === 'containing') f.push('prebiotic');
  if (cls.resistantStarch === 'verified' || cls.resistantStarch === 'suspected') f.push('resistant_starch');
  if (cls.synbiotic === 'verified') f.push('synbiotic');
  if (cls.postbiotic === 'verified') f.push('postbiotic');
  return f;
}

module.exports = {
  classifyGutFood, gutFacetsOf, LEVELS,
  FERMENTED_UNHEATED_RE, FERMENTED_THEN_COOKED_RE,
};
