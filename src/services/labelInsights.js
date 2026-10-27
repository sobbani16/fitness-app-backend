// Educational checks against reviewed label facts, never catalog estimates or AI opinions.
const VERSION = 'label-truth/1.0.0';
const sources = {
  grain: { title: 'VA Nutrition: Whole grains and fiber', url: 'https://www.nutrition.va.gov/NUTRITION/docs/UpdatedPatientEd/WholeGrainsAndFiberJun2024.pdf' },
  label: { title: 'FDA: How to understand and use the Nutrition Facts label', url: 'https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label' },
  sugar: { title: 'CDC: Spotting hidden sugars', url: 'https://www.cdc.gov/diabetes/healthy-eating/spotting-hidden-sugars-in-everyday-foods.html' },
  additive: { title: 'FDA: Types of food ingredients', url: 'https://www.fda.gov/food/food-additives-and-gras-ingredients-information-consumers/types-food-ingredients' },
  allergy: { title: 'FDA: Food allergies', url: 'https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies' },
  diabetes: { title: 'American Diabetes Association: Get to know carbs', url: 'https://diabetes.org/food-nutrition/understanding-carbs/get-to-know-carbs' },
  US: { title: 'FDA: Sugar-free claims (21 CFR 101.60)', url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-and-fda-dear-manufacturer-letter-regarding-sugar-free-claims' },
  IN: { title: 'FSSAI Advertising and Claims Regulations: Schedule I', url: 'https://fssai.gov.in/upload/uploadfiles/files/Compendium_Advertising_Claims_Regulations_14_12_2022.pdf' },
};
const invalid = message => Object.assign(new Error(message), { status: 400 });
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Review label facts');
  const f = {};
  for (const key of ['ingredients', 'allergens', 'claims']) {
    if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > 20000)) throw invalid(`Invalid ${key}`);
    f[key] = input[key] || '';
  }
  for (const key of ['calories', 'proteinG', 'fatG', 'saturatedFatG', 'transFatG', 'sugarG', 'addedSugarG', 'carbsG', 'fiberG', 'sodiumMg', 'basisAmount', 'basisMassG', 'servingsPerContainer', 'portionRatio']) {
    const value = input[key];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000)) throw invalid(`Review ${key}`);
    if (['basisAmount','portionRatio'].includes(key) && value != null && value < 0.001) throw invalid(`Review ${key}`);
    f[key] = value ?? null;
  }
  for (const [key, allowed, fallback] of [['jurisdiction',['US','IN','unknown'],'unknown'], ['basisUnit',['g','ml','unknown'],'unknown'], ['column',['serving','100','unknown'],'unknown'], ['form',['solid','liquid','unknown'],'unknown']]) {
    if (input[key] != null && !allowed.includes(input[key])) throw invalid(`Review ${key}`);
    f[key] = input[key] ?? fallback;
  }
  if (input.reviewed != null && typeof input.reviewed !== 'boolean') throw invalid('Review confirmation required');
  if (input.personalize != null && typeof input.personalize !== 'boolean') throw invalid('Invalid personalization choice');
  if (f.column === '100' && f.basisAmount !== 100) throw invalid('Per-100 column must have a basis of 100');
  if (f.sugarG != null && f.addedSugarG != null && f.addedSugarG > f.sugarG) throw invalid('Added sugars cannot exceed total sugars');
  f.reviewed = input.reviewed === true;
  f.personalize = input.personalize === true;
  return f;
}
// Exact matched substrings are retained; no quantities/percentages inferred from order.
const aliases = [
  ['REFINED_GRAIN_001', /\b(?:maida|refined\s+wheat\s+flour|white\s+wheat\s+flour|all[- ]purpose\s+flour)\b/i, 'Refined wheat flour detected', 'Refining removes much of the bran and germ, generally reducing fiber. Plain “wheat flour” or “atta” alone does not prove a whole-grain product.', 'Compare whole-grain ingredients and labeled fiber for the same quantity.', 'grain'],
  ['WHOLE_GRAIN_001', /\b(?:whole[- ]wheat(?:\s+(?:flour|atta))?|whole[- ]grain\s+(?:oats|wheat)|wholemeal\s+flour)\b/i, 'Whole-grain ingredient named', 'A whole-grain ingredient retains bran, germ and endosperm. Its presence does not establish the whole-grain percentage of this product.', 'Check the rest of the ingredients and compare labeled fiber.', 'grain'],
  ['SUGAR_INGREDIENT_001', /\b(?:jaggery|gur|gud|shakkar|khandsari|mishri|sugar|sucrose|fructose|maltose|malt\s+syrup|rice\s+syrup|dextrose|glucose\s+syrup|corn\s+syrup|invert\s+sugar|cane\s+sugar|honey|molasses)\b/i, 'Sugar-containing ingredient named', 'This ingredient can contribute sugars. The ingredient list alone cannot tell us how much added sugar the finished product contains.', 'Check total and added sugars per portion; do not infer amounts from ingredient order.', 'sugar'],
  ['ADDITIVE_001', /\b(?:lecithin|xanthan\s+gum|sodium\s+benzoate|citric\s+acid|INS\s*\(?\s*(?:322|330|415|211)\)?|E[- ]?(?:322|330|415|211))\b/i, 'Food additive named', 'Additives have functions such as texture, acidity or preservation. An unfamiliar name alone does not establish harm; permitted uses and amounts matter.', 'Check any personal allergy requirements. This finding is not a reason by itself to avoid the food.', 'additive'],
];
function labelMatch(text, pattern) {
  const matcher = new RegExp(pattern.source, 'gi');
  for (const match of text.matchAll(matcher)) {
    const before = text.slice(Math.max(0, match.index - 25), match.index);
    const after = text.slice(match.index + match[0].length);
    if (/\b(?:no|not|without|free from)\s*$/i.test(before) || /^[-\s]*free\b/i.test(after)) continue;
    return match;
  }
  return null;
}
function analyze(input, context = {}) {
  const f = validate(input), insights = [];
  const evidence = (field, text, extra = {}) => ({ type: field === 'claims' ? 'marketing_claim' : field === 'ingredients' ? 'ingredient_label' : field === 'allergens' ? 'allergen_label' : 'nutrition_label', field, text, origin: f.reviewed ? 'USER_REVIEWED_LABEL' : 'UNREVIEWED_OCR', ...extra });
  const add = (ruleId, finding, ev, explanation, recommendation, source, personalRelevance = null, category = 'label_fact', insufficient = false) => insights.push({ ruleId, ruleVersion: VERSION, category, finding, evidence: ev, explanation, personalRelevance, recommendation, source: sources[source], confidence: insufficient ? 'INSUFFICIENT_EVIDENCE' : f.reviewed ? 'VERIFIED' : 'ESTIMATED', confidenceExplanation: insufficient ? 'Required evidence or a complete regulatory assessment is unavailable.' : f.reviewed ? 'Presence/value confirmed by user review, not laboratory verification; explanation is source-backed.' : 'OCR or typed draft has not been confirmed against the package.' });
  const goal = f.personalize ? context.goal || '' : '';
  for (const [id, pattern, finding, explanation, recommendation, source] of aliases) {
    const match = labelMatch(f.ingredients, pattern);
    if (match) add(id, finding, [evidence('ingredients', match[0], { start: match.index, end: match.index + match[0].length })], explanation, recommendation, source, /fiber|fibre/i.test(goal) && source === 'grain' ? 'Your selected goal emphasizes fiber.' : null);
  }
  const allergenMatch = labelMatch(f.ingredients, /\b(?:wheat|maida|milk|casein|whey|peanuts?|soy(?:a)?|sesame|almonds?|cashews?|eggs?)\b/i);
  if (allergenMatch) add('ALLERGEN_INGREDIENT_001', 'Potential allergen ingredient named', [evidence('ingredients', allergenMatch[0], { start: allergenMatch.index, end: allergenMatch.index + allergenMatch[0].length })], 'This ingredient may matter for a food allergy. This is not a complete allergen assessment; processing, derivatives and cross-contact information can matter.', 'Check the full package allergen statement against your dietary requirements. If uncertain, contact the manufacturer before eating.', 'allergy', f.personalize && context.allergies?.length ? `Your saved allergies: ${context.allergies.join(', ')}.` : null);
  if (f.allergens.trim()) add('ALLERGEN_STATEMENT_001', 'Allergen statement needs review', [evidence('allergens', f.allergens)], '“Contains” and “may contain” have different meanings. Missing precautionary wording does not prove a food is safe for an allergy.', 'Compare the full statement with your allergies; contact the manufacturer if unclear.', 'allergy', f.personalize && context.allergies?.length ? `Your saved allergies: ${context.allergies.join(', ')}. Check each against this statement.` : null);
  const claim = labelMatch(f.claims, /\b(?:sugar[- ]free|zero\s+sugars?|no\s+sugars?)\b(?!\s+added)/i);
  if (claim) {
    const known = f.sugarG != null && ((f.jurisdiction === 'US' && f.column === 'serving') || (f.jurisdiction === 'IN' && f.basisAmount && ((f.form === 'solid' && f.basisUnit === 'g') || (f.form === 'liquid' && f.basisUnit === 'ml'))));
    const value = known ? f.jurisdiction === 'IN' ? f.sugarG * 100 / f.basisAmount : f.sugarG : null;
    const mismatch = known && (f.jurisdiction === 'IN' ? value > 0.5 : value >= 0.5);
    add('SUGAR_FREE_CLAIM_001', mismatch ? 'Possible sugar-free claim mismatch' : 'Sugar-free claim needs more evidence', [evidence('claims', claim[0], { start: claim.index, end: claim.index + claim[0].length }), ...(f.sugarG == null ? [] : [evidence('sugarG', `${f.sugarG} g total sugars per reviewed column`, { value: f.sugarG, basisAmount: f.basisAmount, basisUnit: f.basisUnit, column: f.column })])], known ? `${f.jurisdiction === 'IN' ? 'FSSAI’s general threshold is at most 0.5 g per 100 g (solids) or 100 ml (liquids).' : 'FDA’s general threshold is below 0.5 g per labeled serving AND reference amount customarily consumed.'} The reviewed value is ${Number(value.toFixed(3))} g on this comparison basis. Other conditions, product category and rounding still need review; this is not a compliance verdict.` : 'Confirm the market, nutrition column and total sugars. A missing value cannot establish whether this claim fits the label.', 'Check the original package and serving basis; ask the manufacturer about any discrepancy.', f.jurisdiction === 'IN' ? 'IN' : f.jurisdiction === 'US' ? 'US' : 'label', null, 'regulatory_interpretation', !known || !mismatch);
  }
  if (f.claims.trim() && (!claim || f.claims.replace(claim[0], '').replace(/[\s.,;:!\-]/g, '').length > 0)) add('CLAIM_SCOPE_001', 'Marketing claim not automatically assessed', [evidence('claims', f.claims)], 'This rule version does not certify this claim. Claims such as “no added sugar”, “natural” and “high protein” need their own criteria and supporting information.', 'Use the nutrition panel and ingredients, and request supporting information from the manufacturer.', f.jurisdiction === 'IN' ? 'IN' : f.jurisdiction === 'US' ? 'US' : 'label', null, 'regulatory_interpretation', true);
  if (goal && (f.calories != null || f.proteinG != null)) add('GOAL_PORTION_001', 'Use the portion alongside your saved goal', ['calories','proteinG'].filter(k => f[k] != null).map(k => evidence(k, `${k}: ${f[k]} ${k === 'calories' ? 'kcal' : 'g'} per reviewed column`, { value: f[k], basisAmount: f.basisAmount, basisUnit: f.basisUnit })), `Nutrition values apply to the stated quantity, not necessarily the amount you eat. ${f.portionRatio ? `Your portion is ${f.portionRatio} times that quantity.` : 'Your portion is unknown.'} A single product cannot establish whether your daily goal is met.`, 'Use the reviewed portion in your diary and compare daily intake with your existing targets.', 'label', `Your saved goal: ${goal.replace(/_/g, ' ')}.`, 'personalized_guidance', !f.portionRatio);
  if (f.personalize && (context.conditions || []).some(c => /\bdiabetes\b|\bdiabetic\b/i.test(c))) {
    const keys = ['carbsG','addedSugarG','fiberG','sugarG'];
    const ev = keys.filter(k => f[k] != null).map(k => evidence(k, `${k}: ${f[k]} g per reviewed column`, { value: f[k], basisAmount: f.basisAmount, basisUnit: f.basisUnit }));
    if (ev.length) add('DIABETES_PORTION_001', 'Consider total carbohydrate and portion together', ev, `Total carbohydrate includes more than sugar. Reviewed-column values: total carbs ${f.carbsG ?? 'unknown'} g; added sugars ${f.addedSugarG ?? 'unknown'} g; fiber ${f.fiberG ?? 'unknown'} g. ${f.portionRatio && f.carbsG != null ? `Your portion is ${f.portionRatio} times that column: approximately ${Number((f.carbsG * f.portionRatio).toFixed(1))} g total carbs.` : 'Your portion or total carbohydrate is unknown.'} Do not automatically subtract fiber or use sugar alone.`, 'Compare portions and total carbohydrate with your individual care plan; this does not set a carbohydrate limit or medication dose.', 'diabetes', 'You chose to use your saved diabetes condition.', 'personalized_guidance', keys.some(k => f[k] == null) || !f.portionRatio || !f.basisAmount);
  }
  return { version: VERSION, facts: f, insights, limitations: ['No health score or compliance verdict.', 'No ingredient percentages inferred.', 'No comparable verified product pair supplied; no ranked alternatives generated.', 'Missing data remains unknown.'] };
}
async function analyzeForUser(input, userId) {
  const f = validate(input);
  let context = {};
  if (f.personalize) {
    if (!userId) throw invalid('Authenticated account required');
    const user = await require('../lib/prisma').getPrisma().user.findUnique({ where: { id: userId }, select: { goalType: true, healthConditions: { where: { active: true }, select: { condition: { select: { name: true } } } }, allergies: { select: { allergy: { select: { name: true } } } } } });
    context = { goal: user?.goalType, conditions: user?.healthConditions.map(c => c.condition.name) || [], allergies: user?.allergies.map(a => a.allergy.name) || [] };
  }
  // Condition recommendations now come exclusively from the approved clinical rule engine.
  const analysis=analyze(f,{...context,conditions:[]});
  analysis.foodIntelligence=await require('./nutrients/foodIntelligence').safe(()=>require('./nutrients/foodIntelligence').label(f,userId),null);
  return analysis;
}
function compare(first, second) {
  const a = validate(first), b = validate(second);
  if (!a.reviewed || !b.reviewed || !a.basisAmount || !b.basisAmount || a.basisUnit === 'unknown' || a.basisUnit !== b.basisUnit || a.form === 'unknown' || a.form !== b.form) throw invalid('Compare two reviewed labels with known quantities, the same units and the same physical form');
  const items = ['calories','proteinG','carbsG','fiberG','sugarG','addedSugarG','sodiumMg'].filter(key => a[key] != null && b[key] != null).map(key => ({
    ruleId: `COMPARE_${key}`, ruleVersion: VERSION, category: 'label_comparison', finding: `${key}: compare equal quantities`,
    evidence: [{ type:'nutrition_label', field:key, text:`Product A: ${a[key]} per ${a.basisAmount} ${a.basisUnit}`, origin:'USER_REVIEWED_LABEL' }, { type:'nutrition_label', field:key, text:`Product B: ${b[key]} per ${b.basisAmount} ${b.basisUnit}`, origin:'USER_REVIEWED_LABEL' }],
    explanation: `Per 100 ${a.basisUnit}: A ${Number((a[key]*100/a.basisAmount).toFixed(2))}; B ${Number((b[key]*100/b.basisAmount).toFixed(2))} ${key === 'calories' ? 'kcal' : key === 'sodiumMg' ? 'mg' : 'g'}. Each label value is multiplied by 100 and divided by its stated basis.`,
    personalRelevance: null, recommendation: 'Compare products serving the same purpose and consider your actual portion and dietary needs. This does not rank overall healthfulness.', source:sources.label, confidence:'VERIFIED', confidenceExplanation:'Two user-reviewed labels normalized to the same quantity; not laboratory verification.'
  }));
  return { version:VERSION, facts:b, insights:items, limitations:['Only nutrients known on both labels are compared. No overall winner is inferred.'] };
}
module.exports = { analyze, analyzeForUser, validate, compare, labelMatch, VERSION };
