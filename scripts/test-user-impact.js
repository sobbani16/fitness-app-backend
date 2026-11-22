require('dotenv').config({quiet:true});
// Test-user cleanup impact — READ-ONLY. Reports ownership, FK references,
// shared relationships, and deletion blast radius for @test.dev users.
// Emits var/test-user-impact.json + docs/nutrition-intelligence/TEST_USER_CLEANUP_IMPACT.md.
const fs=require('node:fs');
const {getPrisma}=require('../src/lib/prisma');
const p=getPrisma();
// FK edges into User discovered from schema (Restrict edges are the blockers).
const EDGES=[
  ['foodLog','userId'],['waterLog','userId'],['sleepLog','userId'],['workoutSession','userId'],
  ['dailySteps','userId'],['foodPreference','userId'],['userAllergy','userId'],
  ['userHealthCondition','userId'],['userPlanningPreferences','userId'],['macroGoal','userId'],
  ['healthScore','userId'],['dailyMacroScore','userId'],['mealPlan','clientId'],
  ['nutritionistProfile','userId'],['trainerProfile','userId'],['reminderPreference','userId'],
  ['supplementLog','userId'],['userIngredient','userId'],['featureFlagOverride','userId'],
  ['dailyProgressDay','userId'],['dailyScoreSnapshot','userId'],
];
(async()=>{
  const users=await p.user.findMany({where:{email:{endsWith:'@test.dev'}},select:{id:true,email:true,createdAt:true}});
  const ids=new Set(users.map(u=>u.id));
  const emailPrefix={};
  for(const u of users){const m=u.email.match(/^(ms[a-z0-9]+|.+?)-/);const k=m?m[1].slice(0,6):'other';emailPrefix[k]=(emailPrefix[k]||0)+1;}
  const edges={};
  for(const [model,col] of EDGES){
    try{
      const rows=await p[model].findMany({where:{[col]:{in:[...ids]}},select:{[col]:true},take:100000});
      const owned=rows.reduce((s,r)=>s+(ids.has(r[col])?1:0),0);
      if(owned)edges[model]=owned;
    }catch(e){edges[model]=`error: ${e.code||e.message}`;}
  }
  // Shared relationships: meal plans linking test clients to non-test
  // nutritionists, or non-test clients to test nutritionists.
  const plans=await p.mealPlan.findMany({select:{clientId:true,nutritionist:{select:{userId:true}}}}).catch(()=>[]);
  const nonTestIds=new Set((await p.user.findMany({where:{email:{not:{endsWith:'@test.dev'}}},select:{id:true}})).map(u=>u.id));
  const crossLinks={
    testClients_withRealNutritionist:plans.filter(x=>ids.has(x.clientId)&&nonTestIds.has(x.nutritionist?.userId)).length,
    realClients_withTestNutritionist:plans.filter(x=>nonTestIds.has(x.clientId)&&ids.has(x.nutritionist?.userId)).length,
  };
  // Age spread of test accounts
  const ages={};
  for(const u of users){const d=Math.floor((Date.now()-u.createdAt.getTime())/86400000);ages[d<1?'<1d':d<7?'<7d':d<30?'<30d':d<180?'<180d':'>=180d']=(ages[d<1?'<1d':d<7?'<7d':d<30?'<30d':d<180?'>=180d':'>=180d']||0)+1;}
  const report={generatedAt:new Date().toISOString(),testUsers:users.length,edges,crossLinks,ageDistribution:ages,emailPrefixSample:Object.fromEntries(Object.entries(emailPrefix).sort((a,b)=>b[1]-a[1]).slice(0,15))};
  fs.writeFileSync('var/test-user-impact.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,1));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
