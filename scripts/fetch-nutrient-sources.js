// Explicit operator command only. Caches full USDA records; never writes application tables.
require('dotenv').config({quiet:true});
const fs = require('node:fs');
const path = require('node:path');
async function fetchSources(ids, directory, {apiKey=process.env.USDA_API_KEY, fetcher=fetch, pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if (!apiKey) return {pending:'USDA_API_KEY_MISSING',requested:ids.length};
  fs.mkdirSync(directory,{recursive:true});
  const pending=[...new Set(ids.map(String))].filter(id=>/^\d+$/.test(id) && !fs.existsSync(path.join(directory,`${id}.json`)));
  const report={requested:pending.length,fetched:0,missing:[],failures:[]};
  for(let offset=0;offset<pending.length;offset+=20) {
    const batch=pending.slice(offset,offset+20); let response;
    for(let attempt=0;attempt<2;attempt++) {
      try { response=await fetcher(`https://api.nal.usda.gov/fdc/v1/foods?api_key=${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fdcIds:batch.map(Number),format:'full'}),signal:AbortSignal.timeout(20000)}); } catch { response=null; }
      if(response?.ok || (response && response.status<500)) break;
      await pause(1000);
    }
    if(!response?.ok) { report.failures.push({ids:batch,status:response?.status||'NETWORK_ERROR'}); if([401,403,429].includes(response?.status)) {report.pending=pending.slice(offset);break;} continue; }
    const foods=await response.json(); if(!Array.isArray(foods)) throw Error('Invalid USDA response');
    for(const food of foods) {
      if(!batch.includes(String(food.fdcId))) throw Error('Unexpected source ID');
      const target=path.join(directory,`${food.fdcId}.json`);
      fs.writeFileSync(target+'.tmp',JSON.stringify({retrievedAt:new Date().toISOString(),endpoint:'https://api.nal.usda.gov/fdc/v1/foods',food},null,2));fs.renameSync(target+'.tmp',target);report.fetched++;
    }
    report.missing.push(...batch.filter(id=>!foods.some(f=>String(f.fdcId)===id)));
    if(response.headers?.get('x-ratelimit-remaining')==='0') {report.pending=pending.slice(offset+20);break;}
    await pause(1000);
  }
  return report;
}
if(require.main===module) {
  const [file,directory='data/nutrient-sources/usda']=process.argv.slice(2);
  if(!file) throw Error('Usage: node scripts/fetch-nutrient-sources.js ids.json [cache-directory]');
  fetchSources(JSON.parse(fs.readFileSync(file,'utf8')),directory).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('Source fetch failed; cached records are retained.');process.exitCode=1;});
}
module.exports={fetchSources};
