const {evaluate,evaluateForConditions}=require('../src/services/nutrients/conditionEvaluation');
const {validate}=require('../src/services/nutrients/conditionRuleImport');
const initial=require('../data/condition-rules/initial');
const evidence={id:'e',organization:'NIH',guidelineTitle:'Test fixture',sourceUrl:'https://www.niddk.nih.gov/',lastReviewedAt:'2020-01-01',evidenceNotes:'Synthetic unit fixture only'};
const rule={id:'r',code:'TEST',version:1,healthConditionId:'c',healthCondition:{id:'c'},nutrientId:'n',nutrient:{id:'n',code:'SODIUM',unit:'mg'},action:'LIMIT',severity:'INFO',rationale:'Fixture',evidence,reviewStatus:'APPROVED',reviewedBy:'fixture reviewer',reviewedAt:'2020-01-01',applicabilityCriteria:{scope:'CONDITION',requirements:[]}};
const profile={id:'p',ingredientId:'i',verifiedAt:'2020-01-01',sourceCitation:'fixture',nutrients:[{nutrientId:'n',amountPer100g:'200'}],ingredient:{attributes:[{attribute:'CONTAINS_GLUTEN'}]}};
const run=extra=>evaluate({conditions:[{conditionId:'c',active:true}],profile,servingGrams:25,ingredientEvidence:[{ingredientId:'i',attribute:'CONTAINS_GLUTEN',evidence:'Synthetic reviewed label fixture',verifiedAt:'2020-01-01'}],nutrientRules:[rule],...extra});
test('condition match uses serving grams and carries evidence',()=>{const f=run().findings[0];expect(f.actualQuantity.value).toBe('50.000000000');expect(f.evidence.sourceUrl).toBe(evidence.sourceUrl);expect(f.actualQuantity.profileId).toBe('p');});
test('inactive and unrelated conditions do not match',()=>{expect(run({conditions:[{conditionId:'c',active:false}]}).findings).toEqual([]);expect(run({conditions:[{id:'other'}]}).findings).toEqual([]);});
test.each(['DRAFT','REVIEWED'])('%s rules are never exposed',reviewStatus=>expect(run({nutrientRules:[{...rule,reviewStatus}]}).findings).toEqual([]));
test.each([null,undefined])('unknown nutrient %s is not zero',amountPer100g=>expect(run({profile:{...profile,nutrients:[{nutrientId:'n',amountPer100g}]}}).findings[0].status).toBe('INSUFFICIENT_DATA'));
test('explicit zero remains known',()=>expect(run({profile:{...profile,nutrients:[{nutrientId:'n',amountPer100g:0}]}}).findings[0].actualQuantity.value).toBe('0.000000000'));
test.each([0,-1,null,'bad'])('invalid serving %s is insufficient',servingGrams=>expect(run({servingGrams}).findings[0].status).toBe('INSUFFICIENT_DATA'));
test('missing evidence fails closed',()=>expect(run({nutrientRules:[{...rule,evidence:null}]}).findings[0].status).toBe('INSUFFICIENT_DATA'));
test('unverified nutrient profiles cannot drive recommendations',()=>expect(run({profile:{...profile,verifiedAt:null}}).findings[0].status).toBe('INSUFFICIENT_DATA'));
test('medication use is never inferred from a condition',()=>{
 const r={...rule,applicabilityCriteria:{scope:'MEDICATION',requirements:[{key:'takesLevothyroxine',equals:true}]}};
 expect(run({nutrientRules:[r]}).findings[0].personalizationRequirements).toEqual(['takesLevothyroxine']);
 expect(run({nutrientRules:[r],context:{takesLevothyroxine:false}}).findings).toEqual([]);
});
test('population-free numerical thresholds are rejected by import',()=>{
 const d=structuredClone(initial);d.rules[0].thresholdValue=20;d.rules[0].thresholdUnit='g';
 expect(()=>validate(d)).toThrow('population criteria');
});
test('lab requirements are explicit, never inferred',()=>{
 const r={...rule,applicabilityCriteria:{scope:'LAB_DEPENDENT',requirements:[{key:'potassiumRestrictionPrescribed',equals:true}]}};
 expect(run({nutrientRules:[r]}).findings[0].status).toBe('PERSONALIZATION_REQUIRED');
 expect(run({nutrientRules:[r],context:{potassiumRestrictionPrescribed:false}}).findings).toEqual([]);
 expect(run({nutrientRules:[r],context:{potassiumRestrictionPrescribed:true}}).findings[0].status).toBe('GUIDANCE');
});
test('unsupported criteria fail closed',()=>expect(run({nutrientRules:[{...rule,applicabilityCriteria:{unknown:true}}]}).findings[0].status).toBe('INSUFFICIENT_DATA'));
test.each([null,undefined,'true',NaN])('unknown or mistyped clinical fact %s requires personalization',value=>{
 const r={...rule,applicabilityCriteria:{scope:'LAB_DEPENDENT',requirements:[{key:'restriction',equals:true}]}};
 expect(run({nutrientRules:[r],context:{restriction:value}}).findings[0].status).toBe('PERSONALIZATION_REQUIRED');
});
test.each([[null],[{key:'x',equals:true,unsupported:1}],[{key:'x',equals:true},{key:'x',equals:false}]].map(requirements=>[requirements]))('malformed criteria do not crash or silently pass',requirements=>{
 expect(run({nutrientRules:[{...rule,applicabilityCriteria:{scope:'CONDITION',requirements}}]}).findings[0].status).toBe('INSUFFICIENT_DATA');
});
test('expanded drafts keep thyroid and gout guidance specific',()=>{
 expect(initial.rules).toHaveLength(17);
 expect(initial.rules.filter(r=>/thyroid/i.test(r.condition)).every(r=>r.nutrientCode==='IODINE'&&r.requiresPersonalization)).toBe(true);
 expect(initial.rules.find(r=>r.condition==='Gout').attribute).toBe('CONTAINS_HIGH_FRUCTOSE_CORN_SYRUP');
 expect(initial.rules.filter(r=>r.condition==='PCOS')).toEqual([]);
});
test('per-serving and per100g comparisons preserve their basis',()=>{
 const r={...rule,thresholdValue:100,thresholdUnit:'mg',thresholdBasis:'PER_SERVING'};
 expect(run({nutrientRules:[r]}).findings[0].comparison.relation).toBe('BELOW');
 expect(run({nutrientRules:[{...r,thresholdBasis:'PER_100G'}]}).findings[0].comparison.relation).toBe('ABOVE');
});
test('daily limit is not treated as a meal allowance',()=>expect(run({nutrientRules:[{...rule,thresholdValue:100,thresholdUnit:'mg',thresholdBasis:'DAILY'}]}).findings[0].status).toBe('PERSONALIZATION_REQUIRED'));
test('clinician limit remains separate from general threshold',()=>{
 const f=run({nutrientRules:[{...rule,requiresPersonalization:true,thresholdValue:100,thresholdUnit:'mg',thresholdBasis:'PER_SERVING'}],clinicianLimits:[{ruleCode:'TEST',value:0.025,unit:'g',basis:'PER_SERVING',prescribedBy:'fixture clinician',recordedAt:'2020-01-01'}]}).findings[0];
 expect(f.threshold.value).toBe('100');expect(f.clinicianInstruction.origin).toBe('CLINICIAN');expect(f.comparison.relation).toBe('ABOVE');
});
test('conflicting conditions retain both findings',()=>{const r={...rule,id:'r2',healthConditionId:'c2',healthCondition:{id:'c2'},action:'PRIORITIZE'};const result=run({conditions:[{id:'c'},{id:'c2'}],nutrientRules:[rule,r]});expect(result.findings).toHaveLength(2);expect(result.conflicts).toHaveLength(1);});
test('ingredient rules use attributes and unknown does not imply absence',()=>{
 const r={...rule,nutrient:undefined,conditionId:'c',attribute:'CONTAINS_GLUTEN',clinicalAction:'AVOID_IF_INDICATED'};
 expect(run({nutrientRules:[],ingredientRules:[r]}).findings[0].matchedIngredient.attribute).toBe('CONTAINS_GLUTEN');
 expect(run({nutrientRules:[],ingredientRules:[r],profile:{...profile,ingredient:{attributes:[]}}}).findings[0].status).toBe('INSUFFICIENT_DATA');
 expect(run({nutrientRules:[],ingredientRules:[r],ingredientEvidence:[]}).findings[0].reason).toBe('INGREDIENT_CLASSIFICATION_UNVERIFIED');
});
test('initial references validate and all rules remain drafts',()=>{expect(validate(initial)).toBe(initial);expect(initial.conditions).toHaveLength(14);expect(initial.rules.every(r=>r.reviewStatus==='DRAFT')).toBe(true);expect(initial.rules.filter(r=>/thyroid/i.test(r.condition)&&['SODIUM','POTASSIUM'].includes(r.nutrientCode))).toEqual([]);});
test('approvals require reviewer and explicit import flag',()=>{const d=structuredClone(initial);d.rules[0].reviewStatus='APPROVED';expect(()=>validate(d)).toThrow('Review');d.rules[0].reviewedBy='test';d.rules[0].reviewedAt='2020-01-01';expect(()=>validate(d)).toThrow('explicit');expect(()=>validate(d,{allowApproved:true})).not.toThrow();});
test('missing evidence and unsupported nutrient rejected',()=>{const d=structuredClone(initial);d.rules[0].evidenceCode='missing';expect(()=>validate(d)).toThrow();d.rules[0].evidenceCode=initial.rules[0].evidenceCode;d.rules[0].nutrientCode='GLUTEN';expect(()=>validate(d)).toThrow('Unknown nutrient');});
test('database entry point only requests approved rules',async()=>{
 const findMany=jest.fn(async()=>[]);const p={ingredientNutritionProfile:{findUnique:async()=>profile},healthConditionNutrientRule:{findMany},conditionRule:{findMany}};
 await evaluateForConditions(p,{conditions:[{id:'c'}],profileId:'p',servingGrams:25});
 expect(findMany.mock.calls.every(([q])=>q.where.reviewStatus==='APPROVED')).toBe(true);
});
