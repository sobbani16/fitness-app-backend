const { analyze, validate, VERSION } = require('../src/services/labelInsights');
const base = { reviewed: true, ingredients: '', claims: '', allergens: '', sugarG: null };
const find = (facts, id, context) => analyze({ ...base, ...facts }, context).insights.find(x => x.ruleId === id);
test.each(['Maida', 'Refined Wheat Flour', 'all-purpose flour'])('retains exact alias evidence %s', ingredients => {
  const item = find({ ingredients }, 'REFINED_GRAIN_001');
  expect(item.evidence[0]).toMatchObject({ text: ingredients, start: 0, end: ingredients.length });
  expect(item.confidence).toBe('VERIFIED');
});
test.each(['atta', 'wheat flour', 'whole-wheat atta', 'maidan'])('does not infer refined flour from %s', ingredients => expect(find({ ingredients }, 'REFINED_GRAIN_001')).toBeUndefined());
test('wholegrain presence never estimates percentage', () => expect(find({ ingredients: 'Whole-wheat atta, maida' }, 'WHOLE_GRAIN_001').explanation).toContain('does not establish'));
test.each(['jaggery','gur','gud','glucose syrup','honey','dextrose'])('recognizes sugar alias %s without estimating grams', ingredients => expect(find({ ingredients }, 'SUGAR_INGREDIENT_001').explanation).toContain('cannot tell us how much'));
test('additives are neutral', () => expect(find({ ingredients: 'INS 330' }, 'ADDITIVE_001').explanation).toContain('does not establish harm'));
test.each([['US',0.5,true],['US',0.49,false],['IN',0.5,false],['IN',0.51,true]])('jurisdiction %s boundary %s', (jurisdiction,sugarG,mismatch) => {
  const item = find({ claims:'Sugar-free', jurisdiction, sugarG, basisAmount:100, basisUnit:'g', form:'solid', column:'serving' }, 'SUGAR_FREE_CLAIM_001');
  expect(item.finding.includes('mismatch')).toBe(mismatch);
});
test('India normalizes explicit volume without assuming density', () => expect(find({ claims:'zero sugar', jurisdiction:'IN', sugarG:1, basisAmount:200, basisUnit:'ml', form:'liquid' }, 'SUGAR_FREE_CLAIM_001').finding).not.toContain('mismatch'));
test.each([{},{sugarG:0},{sugarG:10,jurisdiction:'US',column:'100',basisAmount:100},{sugarG:10,jurisdiction:'IN'}])('missing basis or market cannot establish compliance %j', change => expect(find({ claims:'sugar free', ...change },'SUGAR_FREE_CLAIM_001').confidence).toBe('INSUFFICIENT_EVIDENCE'));
test.each(['no added sugar','no sugar added','high protein'])('unsupported claim stays unassessed: %s', claims => expect(find({claims},'CLAIM_SCOPE_001').confidence).toBe('INSUFFICIENT_EVIDENCE'));
test('unreviewed input is never verified', () => expect(find({ ingredients:'Maida', reviewed:false },'REFINED_GRAIN_001').confidence).toBe('ESTIMATED'));
test('personalization requires opt in, thyroid alone never creates sodium limits', () => {
  expect(analyze({...base, carbsG:20, sodiumMg:500, personalize:true},{conditions:['hypothyroidism']}).insights).toEqual([]);
  expect(analyze({...base, carbsG:20},{conditions:['diabetes']}).insights).toEqual([]);
});
test('diabetes checks total carbs, added sugars, fiber and portion, preserving unknowns', () => {
  const i = find({personalize:true,carbsG:20,portionRatio:2},'DIABETES_PORTION_001',{conditions:['Type 2 diabetes']});
  expect(i.explanation).toContain('40 g total carbs');
  expect(i.explanation).toContain('added sugars unknown');
  expect(i.explanation).toContain('fiber unknown');
  expect(i.confidence).toBe('INSUFFICIENT_EVIDENCE');
});
test('advisory wording retained exactly without declaring absence safe', () => {
  const i = find({allergens:'May contain peanuts'},'ALLERGEN_STATEMENT_001');
  expect(i.evidence[0].text).toBe('May contain peanuts');
  expect(i.explanation).toContain('does not prove');
});
test('each finding is traceable, sourced and versioned', () => {
  for (const i of analyze({...base,ingredients:'Maida, honey, lecithin',allergens:'Contains wheat',claims:'sugar-free'}).insights) {
    for (const field of ['finding','explanation','recommendation','confidence','confidenceExplanation','ruleId']) expect(i[field]).toBeTruthy();
    expect(i.ruleVersion).toBe(VERSION); expect(i.source.url).toMatch(/^https:\/\//); expect(i.evidence.length).toBeGreaterThan(0);
    for (const e of i.evidence) expect(e.text).toBeTruthy();
  }
});
test.each([{sugarG:-1},{sugarG:'0'},{reviewed:'yes'},{basisAmount:0},{jurisdiction:'XX'},{ingredients:[]}])('rejects invalid data %j', input => expect(()=>validate(input)).toThrow());

test('compares known nutrients on equal quantities and omits missing values', () => {
  const {compare} = require('../src/services/labelInsights');
  const a = {...base, basisAmount:50, basisUnit:'g', form:'solid', sugarG:5};
  const b = {...a,basisAmount:100,sugarG:8,fiberG:3};
  const result = compare(a,b);
  expect(result.insights).toHaveLength(1);
  expect(result.insights[0].explanation).toContain('A 10; B 8 g');
  expect(()=>compare(a,{...b,basisUnit:'ml'})).toThrow();
  expect(()=>compare(a,{...b,reviewed:false})).toThrow();
});
test('saved goal guidance is opt-in and never claims a daily goal is met', () => {
  const i = find({personalize:true,calories:150,proteinG:5,portionRatio:2},'GOAL_PORTION_001',{goal:'muscle_gain'});
  expect(i.personalRelevance).toContain('muscle gain'); expect(i.explanation).toContain('cannot establish');
});
test('liquid nutrition expressed in grams cannot evaluate an India per-ml threshold', () => expect(find({claims:'sugar free',jurisdiction:'IN',form:'liquid',basisUnit:'g',basisAmount:100,sugarG:5},'SUGAR_FREE_CLAIM_001').confidence).toBe('INSUFFICIENT_EVIDENCE'));

test.each(['maida-free', 'No maida', 'Without maida'])('does not turn a negated ingredient into presence: %s', ingredients => expect(find({ingredients},'REFINED_GRAIN_001')).toBeUndefined());
test('negated sugar-free statement is not evaluated as a sugar-free claim', () => expect(find({claims:'Not sugar free'},'SUGAR_FREE_CLAIM_001')).toBeUndefined());
