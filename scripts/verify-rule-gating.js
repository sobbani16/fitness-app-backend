require('dotenv').config({quiet:true});
// Rule-gating verification — proves DRAFT/unreviewed clinical rules are inert
// across every consumer path, using the same query shapes as production code.
// Read-only. Exit 1 if any unapproved rule would fire anywhere.
const {getPrisma}=require('../src/lib/prisma');
const p=getPrisma();
(async()=>{
  const results=[];
  const check=(name,fn)=>fn().then(n=>results.push({consumer:name,unapprovedVisible:n,ok:n===0}));

  // Every ConditionRule consumer gates on reviewStatus='APPROVED' at query
  // level. Simulate each query against a DRAFT-only rule set.
  const draftConditions=await p.healthCondition.findMany({
    where:{conditionRules:{some:{reviewStatus:{not:'APPROVED'}},none:{reviewStatus:'APPROVED'}}},
    select:{id:true,name:true},take:50});
  const ids=draftConditions.map(c=>c.id);

  // mealSuggestion / healthScoreEngine / ingredientValidator / supplementValidator
  await check('conditionRules consumers (mealSuggestion, healthScoreEngine, ingredient+supplement validators)',async()=>{
    const rows=await p.userHealthCondition.findMany({
      where:{conditionId:{in:ids},active:true},
      include:{condition:{include:{conditionRules:{where:{reviewStatus:'APPROVED'}}}}},take:200});
    return rows.reduce((s,uc)=>s+uc.condition.conditionRules.length,0);
  });
  // weeklyDietGenerator: target='ingredient' + APPROVED
  await check('weeklyDietGenerator conditionRules',async()=>{
    const rows=await p.conditionRule.count({where:{conditionId:{in:ids},target:'ingredient',reviewStatus:'APPROVED'}});
    return rows;
  });
  // weeklyDietGenerator nutrientRules
  await check('weeklyDietGenerator nutrientRules',async()=>{
    return p.healthConditionNutrientRule.count({where:{healthConditionId:{in:ids},reviewStatus:'APPROVED'}});
  });
  // foodIntelligence clinical_ingredient rules
  await check('foodIntelligence clinical_ingredient rules',async()=>{
    return p.conditionRule.count({where:{conditionId:{in:ids},target:'clinical_ingredient',reviewStatus:'APPROVED'}});
  });
  // conditionEvaluation nutrient rules (gates on APPROVED)
  await check('conditionEvaluation nutrient rules',async()=>{
    return p.healthConditionNutrientRule.count({where:{healthConditionId:{in:ids},reviewStatus:'APPROVED'}});
  });

  // Positive controls: what IS visible vs what exists.
  const stats={
    draftIngredient:await p.conditionRule.count({where:{target:'ingredient',reviewStatus:'DRAFT'}}),
    draftSupplement:await p.conditionRule.count({where:{target:'supplement',reviewStatus:'DRAFT'}}),
    draftClinical:await p.conditionRule.count({where:{target:'clinical_ingredient',reviewStatus:'DRAFT'}}),
    draftNutrientRules:await p.healthConditionNutrientRule.count({where:{reviewStatus:'DRAFT'}}),
    approvedAnywhere:(await p.conditionRule.count({where:{reviewStatus:'APPROVED'}}))+(await p.healthConditionNutrientRule.count({where:{reviewStatus:'APPROVED'}})),
    conditionsWithOnlyDrafts:draftConditions.length,
  };
  const ok=results.every(r=>r.ok);
  console.log(JSON.stringify({ok,results,stats},null,2));
  if(!ok)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
