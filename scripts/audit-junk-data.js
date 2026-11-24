require('dotenv').config({quiet:true});
// Junk-data audit + cleanup. Dry-run by default; --apply writes.
// --report <file> writes a JSON report (default junk-data-report.json).
// Scope: test-residue `ms*` rows in Ingredient/Allergy/HealthCondition,
// dummy-* fdcIds, impossible kcal/100g, case-variant dup reference rows.
// Report-only: normalizedName dupes, zero-kcal rows, @test.dev users,
// `ms*` recipes — merging/deleting those needs product review.
const fs=require('node:fs'),path=require('node:path');
const {getPrisma}=require('../src/lib/prisma');
const args=process.argv.slice(2),value=f=>{const i=args.indexOf(f);return i<0?null:args[i+1];};
const allowed=['--apply','--approved-hosted','--report'];
for(let i=0;i<args.length;i++){if(!allowed.includes(args[i]))throw Error('Unknown option');if(args[i]!=='--apply'&&args[i]!=='--approved-hosted'){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing option value');i++;}}
const apply=args.includes('--apply'),url=new URL(process.env.DATABASE_URL||'http://missing');
if(apply&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!args.includes('--approved-hosted'))throw Error('Hosted writes need separate approval and --approved-hosted');
const p=getPrisma();
const MS=/^ms[a-z0-9]{5,}\s/i; // test-residue prefix: ms<base36-timestamp>
const file=value('--report')||'junk-data-report.json';
const report={apply,generatedAt:new Date().toISOString(),actions:[],reportOnly:{}};
const act=(kind,ids,detail)=>report.actions.push({kind,count:Array.isArray(ids)?ids.length:ids,detail});
async function sweep(table,finder,children){
  const rows=await finder();
  const junk=rows.filter(r=>MS.test(r.name));
  act(`${table}:test-residue-delete`,junk.map(r=>r.id),{names:[...new Set(junk.map(r=>r.name.replace(/^ms[a-z0-9]+\s+/i,'* ')))]});
  if(apply&&junk.length)for(const step of children(junk.map(r=>r.id)))await step();
  return junk;
}
(async()=>{
  // 1. Ingredient test residue — profiles Restrict FK, delete explicitly first.
  await sweep('ingredient',()=>p.ingredient.findMany({select:{id:true,name:true}}),ids=>[
    ()=>p.ingredientNutrient.deleteMany({where:{nutritionProfile:{ingredientId:{in:ids}}}}),
    ()=>p.ingredientNutritionProfile.deleteMany({where:{ingredientId:{in:ids}}}),
    ()=>p.ingredient.deleteMany({where:{id:{in:ids}}}).catch(e=>act('ingredient:delete-blocked',ids.length,e.code||e.message)),
  ]);
  // 2. Allergy test residue — user links first (no cascade on that edge).
  await sweep('allergy',()=>p.allergy.findMany({select:{id:true,name:true}}),ids=>[
    ()=>p.userAllergy.deleteMany({where:{allergyId:{in:ids}}}),
    ()=>p.allergy.deleteMany({where:{id:{in:ids}}}).catch(e=>act('allergy:delete-blocked',ids.length,e.code||e.message)),
  ]);
  // 3. HealthCondition test residue — links, attribute rules, nutrient rules.
  await sweep('healthCondition',()=>p.healthCondition.findMany({select:{id:true,name:true}}),ids=>[
    ()=>p.userHealthCondition.deleteMany({where:{conditionId:{in:ids}}}),
    ()=>p.conditionRule.deleteMany({where:{conditionId:{in:ids}}}),
    ()=>p.healthConditionNutrientRule.deleteMany({where:{healthConditionId:{in:ids}}}).catch(()=>0),
    ()=>p.healthCondition.deleteMany({where:{id:{in:ids}}}).catch(e=>act('healthCondition:delete-blocked',ids.length,e.code||e.message)),
  ]);
  // 3b. Recipe test residue — RecipeIngredient cascades from Recipe.
  const msRecipes=await p.recipe.findMany({where:{recipeName:{startsWith:'ms'}},select:{id:true,recipeName:true}}).catch(()=>[]);
  const junkRecipes=msRecipes.filter(r=>MS.test(r.recipeName));
  act('recipe:test-residue-delete',junkRecipes.map(r=>r.id),{names:[...new Set(junkRecipes.map(r=>r.recipeName.replace(/^ms[a-z0-9]+\s+/i,'* ')))].slice(0,20)});
  if(apply&&junkRecipes.length)await p.recipe.deleteMany({where:{id:{in:junkRecipes.map(r=>r.id)}}}).catch(e=>act('recipe:delete-blocked',junkRecipes.length,e.code||e.message));
  // 4. dummy-* fdcIds — a fake provenance id is worse than none.
  const dummies=await p.ingredient.findMany({where:{fdcId:{startsWith:'dummy-'}},select:{id:true,name:true,fdcId:true}});
  act('ingredient:dummy-fdcId-null',dummies.map(d=>d.id),{names:dummies.map(d=>d.name)});
  if(apply&&dummies.length)await p.ingredient.updateMany({where:{id:{in:dummies.map(d=>d.id)}},data:{fdcId:null}});
  // 5. Impossible energy density (>900 kcal/100g > pure fat) — delete; the
  // column is non-nullable so there is no honest "unknown" placeholder.
  const impossible=await p.ingredient.findMany({where:{caloriesPer100g:{gt:900}},select:{id:true,name:true,caloriesPer100g:true}});
  act('ingredient:impossible-kcal-delete',impossible.map(i=>i.id),{names:impossible.map(i=>`${i.name} (${i.caloriesPer100g})`)});
  if(apply&&impossible.length){
    const ids=impossible.map(i=>i.id);
    await p.ingredientNutrient.deleteMany({where:{nutritionProfile:{ingredientId:{in:ids}}}});
    await p.ingredientNutritionProfile.deleteMany({where:{ingredientId:{in:ids}}});
    await p.ingredient.deleteMany({where:{id:{in:ids}}}).catch(e=>act('ingredient:impossible-blocked',ids.length,e.code||e.message));
  }
  // 5b. RuleEvidence test residue — 'Test Fixture' org rows leak when a test
  // teardown aborts mid-way (ms*-EV codes). Rows still referenced by a live
  // ConditionRule (Restrict FK) are report-only — deleting them needs the
  // referencing rule removed first, which is a governance decision.
  const evResidue=await p.ruleEvidence.findMany({where:{organization:'Test Fixture'},select:{id:true,code:true}});
  const evIds=evResidue.map(r=>r.id);
  const evRefs=evIds.length?await p.conditionRule.findMany({where:{evidenceSourceId:{in:evIds}},select:{evidenceSourceId:true}}):[];
  const referenced=new Set(evRefs.map(r=>r.evidenceSourceId));
  const orphaned=evResidue.filter(r=>!referenced.has(r.id));
  act('ruleEvidence:test-residue-delete',orphaned.map(r=>r.id),{codes:orphaned.map(r=>r.code),referencedSkipped:referenced.size});
  if(apply&&orphaned.length)await p.ruleEvidence.deleteMany({where:{id:{in:orphaned.map(r=>r.id)}}}).catch(e=>act('ruleEvidence:delete-blocked',orphaned.length,e.code||e.message));
  // 5c. test-fixture ingredients — `source='test-fixture'` is the explicit
  // fixture marker (creators predate the ms* convention; no committed code
  // currently writes it). Rows with user/catalog references are ambiguous —
  // deleting them changes someone else's data, so they are report-only.
  // Only unreferenced rows are safe to remove.
  const fixIngs=await p.ingredient.findMany({where:{source:'test-fixture'},select:{id:true,name:true}});
  const fixIds=fixIngs.map(i=>i.id);
  const [fixUser,fixRec,fixLog,fixSrv,fixAttr,fixProf]=await Promise.all([
    p.userIngredient.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
    p.recipeIngredient.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
    p.foodLog.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
    p.ingredientServing.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
    p.ingredientAttribute.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
    p.ingredientNutritionProfile.findMany({where:{ingredientId:{in:fixIds}},select:{ingredientId:true}}),
  ]);
  const fixRefCount={};for(const r of [...fixUser,...fixRec,...fixLog,...fixSrv,...fixAttr,...fixProf])fixRefCount[r.ingredientId]=(fixRefCount[r.ingredientId]||0)+1;
  const fixOrphan=fixIngs.filter(i=>!fixRefCount[i.id]);
  const fixReferenced=fixIngs.filter(i=>fixRefCount[i.id]);
  act('ingredient:test-fixture-delete',fixOrphan.map(i=>i.id),{names:fixOrphan.map(i=>i.name),referencedSkipped:fixReferenced.map(i=>`${i.name}(${fixRefCount[i.id]} refs)`)});
  if(apply&&fixOrphan.length)await p.ingredient.deleteMany({where:{id:{in:fixOrphan.map(i=>i.id)}}}).catch(e=>act('ingredient:test-fixture-blocked',fixOrphan.length,e.code||e.message));
  report.reportOnly.testFixtureReferenced=fixReferenced.map(i=>({id:i.id,name:i.name,refs:fixRefCount[i.id]}));

  // 6. Case-variant dup reference rows (e.g. peanut / Peanuts) — merge into
  // the lower-case-canonical survivor after repointing user links.
  for(const [table,link,linkField] of [['allergy','userAllergies','allergyId'],['healthCondition','userConditions','conditionId']]){
    const rows=await p[table].findMany({select:{id:true,name:true,[link]:{select:{id:true}}}});
    const groups={};for(const r of rows)if(!MS.test(r.name))(groups[r.name.toLowerCase()]??=[]).push(r);
    for(const [key,grp] of Object.entries(groups)){
      if(grp.length<2)continue;
      const survivor=grp.slice().sort((a,b)=>b[link].length-a[link].length||a.id.localeCompare(b.id))[0];
      const losers=grp.filter(g=>g.id!==survivor.id);
      act(`${table}:case-dup-merge`,losers.map(l=>l.id),{kept:survivor.name,lost:losers.map(l=>l.name)});
      if(apply)for(const l of losers){
        await p[link === 'userAllergies' ? 'userAllergy' : 'userHealthCondition'].updateMany({where:{[linkField]:l.id},data:{[linkField]:survivor.id}});
        await p[table].delete({where:{id:l.id}}).catch(e=>act(`${table}:merge-blocked`,1,e.code||e.message));
      }
    }
  }
  // 7. Report-only findings.
  const ings=await p.ingredient.findMany({select:{normalizedName:true,name:true,caloriesPer100g:true}});
  const dups={};for(const i of ings){const k=(i.normalizedName||i.name||'').toLowerCase();(dups[k]??=[]).push(i.name);}
  report.reportOnly.duplicateNames=Object.entries(dups).filter(([,v])=>v.length>1).map(([k,v])=>({normalized:k,rows:v.length,names:[...new Set(v)].slice(0,12)}));
  report.reportOnly.zeroKcalRows=ings.filter(i=>i.caloriesPer100g===0).length;
  report.reportOnly.testResidueUsers=await p.user.count({where:{email:{endsWith:'@test.dev'}}});
  report.reportOnly.allergyNames=await p.allergy.findMany({select:{name:true}}).then(r=>r.map(x=>x.name).sort());
  fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(report,null,2));fs.renameSync(file+'.tmp',file);
  console.log(JSON.stringify({apply,actions:report.actions.map(a=>`${a.kind}:${a.count}`),reportOnly:report.reportOnly,report:file}));
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
