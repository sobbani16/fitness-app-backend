require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path');
const {getPrisma}=require('../src/lib/prisma');
const {fromUsda,fromReviewed}=require('../src/services/nutrients/sources');
const {populate}=require('../src/services/nutrients/population');
const args=process.argv.slice(2), value=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
const allowed=['--apply','--approved-hosted','--source-dir','--reviewed-dir','--matches','--report','--batch-size'];
for(let i=0;i<args.length;i++){if(!allowed.includes(args[i]))throw Error('Unknown option');if(!['--apply','--approved-hosted'].includes(args[i])){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing option value');i++;}}
const apply=args.includes('--apply'), url=new URL(process.env.DATABASE_URL||'http://missing');
if(apply&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!args.includes('--approved-hosted'))throw Error('Hosted writes need separate approval and --approved-hosted');
const sources=[],sourceErrors=[];
for(const [directory,adapter] of [[value('--source-dir')||'data/nutrient-sources/usda',fromUsda],[value('--reviewed-dir'),fromReviewed]]) {
 if(!directory||!fs.existsSync(directory))continue;
 for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.json')).sort())try{sources.push(adapter(JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'))));}catch(e){sourceErrors.push({file,reason:e.message});}
}
const file=value('--report')||'nutrient-population-report.json';fs.mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
const checkpoint=report=>{fs.writeFileSync(file+'.tmp',JSON.stringify({...report,sourceErrors},null,2));fs.renameSync(file+'.tmp',file);};
const p=getPrisma();
populate(p,sources,{apply,batchSize:Number(value('--batch-size')||25),overrides:value('--matches')?JSON.parse(fs.readFileSync(value('--matches'),'utf8')):[],checkpoint}).then(r=>console.log(JSON.stringify({processed:r.processedIngredients,imported:r.importedProfilesThisRun,verified:r.after.verifiedProfiles,manualReview:r.manualReview.length,pending:r.pendingImports.length,failed:r.failedImports.length,sourceErrors:sourceErrors.length,report:file}))).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>p.$disconnect());
