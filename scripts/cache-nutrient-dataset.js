// Cache only exact candidate records from an operator-downloaded official USDA JSON dataset.
// Retains all candidates; the population step still rejects ambiguous matches.
const fs=require('node:fs'),path=require('node:path');
const {canonical}=require('../src/services/nutrients/matching');
const {fromUsda}=require('../src/services/nutrients/sources');
const [snapshotFile,datasetFile,officialUrl,directory='data/nutrient-sources/usda']=process.argv.slice(2);
if(!snapshotFile||!datasetFile||!officialUrl)throw Error('Usage: node scripts/cache-nutrient-dataset.js ingredient-snapshot.json dataset.json official-download-url [cache-dir]');
const ingredients=JSON.parse(fs.readFileSync(snapshotFile,'utf8')).ingredients;
const names=new Set(ingredients.flatMap(i=>[i.name,...(i.catalog?.aliases||[])]).map(canonical));
const dataset=JSON.parse(fs.readFileSync(datasetFile,'utf8'));
const foods=dataset.SRLegacyFoods||dataset.FoundationFoods;
if(!Array.isArray(foods))throw Error('Expected USDA SRLegacyFoods or FoundationFoods');
fs.mkdirSync(directory,{recursive:true});let cached=0, skippedInvalid=0;
for(const food of foods) {
 if(!food?.description){skippedInvalid++;continue;}
 if(!names.has(canonical(food.description)))continue;
 const file=path.join(directory,`${food.fdcId}.json`);if(fs.existsSync(file))continue;
 const envelope={endpoint:officialUrl,retrievedAt:new Date().toISOString(),food};fromUsda(envelope);
 fs.writeFileSync(file+'.tmp',JSON.stringify(envelope,null,2));fs.renameSync(file+'.tmp',file);cached++;
}
console.log({sourceFoodsExamined:foods.length,cached,skippedInvalid});
