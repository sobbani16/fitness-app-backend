require('dotenv').config({quiet:true});
// Read-only fiber data-quality + provenance audit (pc-HUM-3).
// No writes, no --apply — prints a JSON report and a compact table.
// Source comparison uses the embedded source record only (USDA nutrientId
// 1079 "Fiber, total dietary", or the humai-catalog import record). Rows
// without extractable provenance are UNVERIFIED — never scored as pass/fail.
const {getPrisma}=require('../src/lib/prisma');
const p=getPrisma();
const USDA_FIBER_ID=1079;
const FIXTURE=/^ms[a-z0-9]{5,}\s/i;

// Extract the source-declared fiber value + basis from a row's provenance.
function sourceFiber(row){
  const meta=row.sourceMetadata;
  if(meta?.nutrients&&Array.isArray(meta.nutrients)){
    const n=meta.nutrients.find(x=>x.nutrientId===USDA_FIBER_ID||/fiber.*total dietary/i.test(x.nutrientName||''));
    if(n)return {value:Number(n.value),basis:`USDA nutrient ${USDA_FIBER_ID} (${n.unitName||'?'}/100g)`,ref:`fdcId ${meta.fdcId||row.fdcId||'?'} · ${meta.dataType||'?'}`};
  }
  const rec=row.catalog?.sourceRecord;
  if(rec&&typeof rec==='object'){
    if(Number.isFinite(rec.fiber_g_per_100g))return {value:Number(rec.fiber_g_per_100g),basis:`catalog import record (g/100g, ${rec.carb_definition||'basis n/a'})`,ref:`batch ${row.catalog.importBatch||'?'}`};
    if(Array.isArray(rec.nutrients)){
      const n=rec.nutrients.find(x=>x.nutrientId===USDA_FIBER_ID||/fiber.*total dietary/i.test(x.nutrientName||''));
      if(n)return {value:Number(n.value),basis:`catalog USDA nutrient ${USDA_FIBER_ID} (${n.unitName||'?'}/100g)`,ref:`fdcId ${rec.fdcId||row.fdcId||'?'}`};
    }
  }
  return null; // no extractable provenance
}

(async()=>{
  const rows=await p.ingredient.findMany({
    select:{id:true,name:true,fiberPer100g:true,carbsPer100g:true,fatPer100g:true,proteinPer100g:true,caloriesPer100g:true,source:true,fdcId:true,sourceMetadata:true,
      catalog:{select:{sourceRecord:true,importBatch:true,preparation:true,verificationLevel:true,reviewRequired:true,usable:true}},
      servings:{select:{grams:true,label:true,estimated:true}}},
    orderBy:{name:'asc'},
  });
  const isFixture=r=>r.source==='test-fixture'||r.source==='test'||FIXTURE.test(r.name);
  const catalog=rows.filter(r=>!isFixture(r));
  const fixtures=rows.filter(isFixture);

  // --- Census ---------------------------------------------------------------
  const census={
    rows:catalog.length,fixturesExcluded:fixtures.length,
    nullFiber:catalog.filter(r=>r.fiberPer100g==null).length,
    zeroFiber:catalog.filter(r=>r.fiberPer100g===0).length,
    positiveFiber:catalog.filter(r=>r.fiberPer100g>0).length,
    negative:catalog.filter(r=>r.fiberPer100g<0).length,
    nonFinite:catalog.filter(r=>r.fiberPer100g!=null&&!Number.isFinite(r.fiberPer100g)).length,
  };

  // --- Review flags (not corrections) ---------------------------------------
  const flags=[];
  for(const r of catalog){
    const f=r.fiberPer100g;
    if(f!=null&&f>100)flags.push({id:r.id,name:r.name,flag:`fiberPer100g ${f}>100 g — impossible basis`});
    else if(f!=null&&f>50)flags.push({id:r.id,name:r.name,flag:`fiberPer100g ${f}>50 g — plausible only for dense dry goods (spices/bran); review basis`});
    if(f!=null&&r.carbsPer100g!=null&&f>r.carbsPer100g+0.01)flags.push({id:r.id,name:r.name,flag:`fiber ${f} > total carbs ${r.carbsPer100g} — definition/unit inconsistency`});
    for(const s of r.servings){
      if(!(s.grams>0))flags.push({id:r.id,name:r.name,flag:`serving "${s.label}" grams=${s.grams} ≤0`});
      else if(s.grams>2000)flags.push({id:r.id,name:r.name,flag:`serving "${s.label}" grams=${s.grams} implausibly large`});
    }
  }

  // --- Stratified sample (~12) ----------------------------------------------
  const pick=(pred,n)=>catalog.filter(pred).slice(0,n);
  const sample=[
    ...pick(r=>r.source==='usda'&&r.fiberPer100g>0&&r.fiberPer100g<10,2),
    ...pick(r=>r.source==='usda'&&r.fiberPer100g>=10,2),
    ...pick(r=>r.source==='usda'&&r.fiberPer100g===0,2),
    ...pick(r=>r.source==='usda'&&r.fiberPer100g==null,1),
    ...pick(r=>r.source==='humai-catalog'&&r.fiberPer100g>0,2),
    ...pick(r=>r.source==='humai-catalog'&&(r.fiberPer100g==null||r.fiberPer100g===0),1),
    ...pick(r=>r.source==='seed',2),
  ].slice(0,12);

  const TOL=0.051; // documented tolerance: import rounds to ≤2dp (0.05 g/100g)
  const evidence=sample.map(r=>{
    const src=sourceFiber(r);
    let verdict;
    if(!src)verdict='unverifiable — no extractable provenance';
    else if(src.basis.includes('catalog import'))verdict=Math.abs(r.fiberPer100g-src.value)<=TOL?'internally consistent (import record only — source accuracy unverified)':`INCONSISTENT vs import record (${src.value})`;
    else if(r.fiberPer100g==null)verdict=src.value==null?'consistent (both missing)':`CONFIRMED DISCREPANCY — stored null vs source ${src.value}`;
    else verdict=Math.abs(r.fiberPer100g-src.value)<=TOL?'matches source':'CONFIRMED DISCREPANCY';
    return {id:r.id,name:r.name,source:r.source,stored:r.fiberPer100g,sourceValue:src?.value??null,basis:src?.basis??null,ref:src?.ref??null,verdict};
  });

  const summary={
    census,
    flagCount:flags.length,
    sampleSize:evidence.length,
    verdicts:{matches:evidence.filter(e=>e.verdict==='matches source').length,internallyConsistent:evidence.filter(e=>e.verdict.startsWith('internally')).length,discrepancies:evidence.filter(e=>e.verdict.startsWith('CONFIRMED')).length,unverifiable:evidence.filter(e=>e.verdict.startsWith('unverifiable')).length},
    toleranceG:TOL,
  };
  console.log(JSON.stringify({summary,flags,evidence},null,1));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
