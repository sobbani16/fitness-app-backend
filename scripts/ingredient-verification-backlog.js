require('dotenv').config({quiet:true});
// Ingredient verification backlog — READ-ONLY triage for the ~510 ingredients
// without verified nutrition profiles. Prioritizes by real usage (recipe
// lines + logged foods). Emits var/ingredient-backlog.json +
// docs/nutrition-intelligence/INGREDIENT_VERIFICATION_BACKLOG.md.
// Categories: verified | proxy (fdcId present, no profile) | estimate
// (hand-entered per-100g values, no provenance) | missing | incorrect.
// Nothing here invents or infers nutrient values.
const fs=require('node:fs');
const {getPrisma}=require('../src/lib/prisma');
const p=getPrisma();
(async()=>{
  const [ings,profiles,recipeLines,foodNames]=await Promise.all([
    p.ingredient.findMany({select:{id:true,name:true,normalizedName:true,fdcId:true,source:true,caloriesPer100g:true,proteinPer100g:true,carbsPer100g:true,fatPer100g:true,fiberPer100g:true,sourceMetadata:true}}),
    p.ingredientNutritionProfile.findMany({select:{ingredientId:true,verifiedAt:true,source:true}}),
    p.recipeIngredient.findMany({select:{ingredientName:true,recipeId:true}}),
    p.foodLog.findMany({select:{foodName:true},distinct:['foodName']}),
  ]);
  const verified=new Set(profiles.filter(x=>x.verifiedAt).map(x=>x.ingredientId));
  const profiled=new Set(profiles.map(x=>x.ingredientId));
  // Usage index: normalized recipe ingredient names + logged food names.
  const usage=new Map();
  const bump=(name,w)=>{const k=String(name||'').toLowerCase().trim();if(k)usage.set(k,(usage.get(k)||0)+w);};
  for(const r of recipeLines)bump(r.ingredientName,2);
  for(const f of foodNames)bump(f.foodName,3);
  const rows=ings.map(i=>{
    const key=(i.normalizedName||i.name||'').toLowerCase();
    const hit=usage.get(key)||0;
    const nameHit=usage.get((i.name||'').toLowerCase())||0;
    const usageScore=Math.max(hit,nameHit);
    let cat;
    if(verified.has(i.id))cat='verified';
    else if(i.fdcId)cat='proxy';           // source-linked, profile not yet built
    else if(profiled.has(i.id))cat='profile_unverified';
    else if(i.caloriesPer100g!=null)cat='estimate'; // values exist, no source
    else cat='missing';
    const flags=[];
    if(i.caloriesPer100g!=null&&i.caloriesPer100g===0)flags.push('zero_kcal');
    if(i.caloriesPer100g!=null&&i.caloriesPer100g>900)flags.push('impossible_kcal');
    if(i.fiberPer100g==null)flags.push('fiber_unknown');
    if(i.source==='usda'&&!i.fdcId)flags.push('claims_usda_no_id');
    return {id:i.id,name:i.name,source:i.source,fdcId:i.fdcId,category:cat,usageScore,flags};
  });
  rows.sort((a,b)=>b.usageScore-a.usageScore||a.name.localeCompare(b.name));
  const cat=x=>rows.filter(r=>r.category===x).length;
  const summary={total:rows.length,verified:cat('verified'),proxy:cat('proxy'),profile_unverified:cat('profile_unverified'),estimate:cat('estimate'),missing:cat('missing'),incorrectRows:rows.filter(r=>r.flags.includes('impossible_kcal')).length,zeroKcal:rows.filter(r=>r.flags.includes('zero_kcal')).length,claimsUsdaNoId:rows.filter(r=>r.flags.includes('claims_usda_no_id')).length,usedInRecipesOrLogs:rows.filter(r=>r.usageScore>0).length};
  fs.writeFileSync('var/ingredient-backlog.json',JSON.stringify({summary,rows},null,2));
  const topUnverified=rows.filter(r=>r.category!=='verified').slice(0,40);
  const md=['# INGREDIENT_VERIFICATION_BACKLOG — prioritized triage','',
   `**Generated:** ${new Date().toISOString()} · \`node scripts/ingredient-verification-backlog.js\` · full row data: \`var/ingredient-backlog.json\``,'',
   '## Summary','',
   '| Category | Count | Meaning |','|---|---|---|',
   `| verified | ${summary.verified} | IngredientNutritionProfile with verifiedAt (USDA-backed) |`,
   `| proxy | ${summary.proxy} | Has fdcId but no profile — next-up for the population pipeline |`,
   `| profile_unverified | ${summary.profile_unverified} | Profile exists, not verified |`,
   `| estimate | ${summary.estimate} | per-100g values present, no provenance — never treat as verified |`,
   `| missing | ${summary.missing} | No values at all |`,
   `| flags | — | zero-kcal rows: ${summary.zeroKcal} · claims source='usda' w/o fdcId: ${summary.claimsUsdaNoId} |`,
   '',
   `Ingredients referenced by recipe lines or logged foods: **${summary.usedInRecipesOrLogs}** — these rank first below (usageScore = 3×logged + 2×recipe).`,'',
   '## Rules for this backlog','',
   '- Never invent nutrient values; "estimate" rows keep honest `coverage` semantics — missing is never zero.','- Verified/proxy/estimate/missing are disjoint; a proxy row graduates only via the population importer (source match + profile build), not by copying per-100g estimates into a profile.','- Dedupe is separate work (D12) — canonical mapping must preserve historical FoodLog/RecipeIngredient name references.','',
   '## Top 40 unverified by usage','',
   '| # | Ingredient | Source | fdcId | Category | Usage | Flags |','|---|---|---|---|---|---|---|'];
  topUnverified.forEach((r,i)=>md.push(`| ${i+1} | ${r.name.replace(/\|/g,'\\|')} | ${r.source} | ${r.fdcId??'—'} | ${r.category} | ${r.usageScore} | ${r.flags.join(', ')||'—'} |`));
  fs.writeFileSync('docs/nutrition-intelligence/INGREDIENT_VERIFICATION_BACKLOG.md',md.join('\n')+'\n');
  console.log(JSON.stringify(summary));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
