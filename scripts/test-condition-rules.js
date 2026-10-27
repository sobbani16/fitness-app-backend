const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const url=new URL(process.env.DATABASE_URL||'http://missing');
if(url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/fitness_nutrient_'))throw Error('Use only a local fitness_nutrient_ validation database');
const {getPrisma}=require('../src/lib/prisma');
const {importConditionRules}=require('../src/services/nutrients/conditionRuleImport');
const {evaluateForConditions}=require('../src/services/nutrients/conditionEvaluation');
const initial=require('../data/condition-rules/initial');
const p=getPrisma();
(async()=>{
 const ingredients=await p.ingredient.findMany({orderBy:{id:'asc'}});
 const profiles=await p.ingredientNutritionProfile.findMany({orderBy:{id:'asc'},include:{nutrients:{orderBy:{id:'asc'}}}});
 await importConditionRules(p,initial,{apply:true});
 const read=async()=>({e:await p.ruleEvidence.findMany({orderBy:{code:'asc'}}),r:await p.healthConditionNutrientRule.findMany({orderBy:{code:'asc'}}),i:await p.conditionRule.findMany({orderBy:{id:'asc'}}),c:await p.healthCondition.findMany({orderBy:{id:'asc'}})});
 const before=await read();
 const retry=await importConditionRules(p,initial,{apply:true});
 assert(retry.rules.every(r=>r.status==='UNCHANGED'));assert.deepEqual(await read(),before);
 const c=await p.healthCondition.findUnique({where:{name:'Type 1 Diabetes'}});
 const result=await evaluateForConditions(p,{conditions:[{conditionId:c.id}],profileId:profiles[0].id,servingGrams:50});
 assert.equal(result.findings.length,0);assert.equal(result.status,'INSUFFICIENT_DATA');
 const nonce=randomUUID(),d=structuredClone(initial);
 d.evidence=d.evidence.slice(0,1).map(e=>({...e,code:nonce}));
 d.rules=[{...d.rules[0],code:nonce,evidenceCode:nonce,reviewStatus:'APPROVED',reviewedBy:'synthetic test reviewer',reviewedAt:'2020-01-01T00:00:00Z'}];
 try {
  await importConditionRules(p,d,{apply:true,allowApproved:true});
  const changed=structuredClone(d);changed.rules[0].version=2;changed.rules[0].rationale='changed';
  await assert.rejects(()=>importConditionRules(p,changed,{apply:true,allowApproved:true}),/protected/);
  const approved=await evaluateForConditions(p,{conditions:[{conditionId:c.id}],profileId:profiles[0].id,servingGrams:50});
  assert.equal(approved.findings.length,1);assert.equal(approved.findings[0].ruleCode,nonce);
  const evidence=await p.ruleEvidence.findUnique({where:{code:nonce}});
  await assert.rejects(()=>p.ruleEvidence.delete({where:{id:evidence.id}}));
  await assert.rejects(()=>p.healthConditionNutrientRule.update({where:{code:nonce},data:{reviewedBy:null}}));
 } finally {
  await p.healthConditionNutrientRule.deleteMany({where:{code:nonce}});
  await p.ruleEvidence.deleteMany({where:{code:nonce}});
 }
 assert.deepEqual(await p.ingredient.findMany({orderBy:{id:'asc'}}),ingredients);
 assert.deepEqual(await p.ingredientNutritionProfile.findMany({orderBy:{id:'asc'},include:{nutrients:{orderBy:{id:'asc'}}}}),profiles);
 console.log('PASS: idempotent condition/evidence/rule imports, draft exclusion, approved evaluation, approved mutation protection, evidence FK, approval constraint, existing ingredients/profiles unchanged');
 console.log(JSON.stringify({conditions:initial.conditions.length,evidence:initial.evidence.length,draftRules:initial.rules.length,approvedRules:await p.healthConditionNutrientRule.count({where:{reviewStatus:'APPROVED'}})}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
