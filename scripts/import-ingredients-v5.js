const fs=require('node:fs');const path=require('node:path');const {parseCsv,checksum}=require('../src/services/ingredientCsv');const {importV5}=require('../src/services/ingredientImportV5');const {getPrisma}=require('../src/lib/prisma');
const args=process.argv.slice(2);const filename=args.find(x=>!x.startsWith('--')) || 'data/imports/humai_ingredient_catalog_v5_with_verification_labels.csv';
(async()=>{try {
 if(args.some(x=>x.startsWith('--') && !['--apply','--approved-hosted'].includes(x)))throw Error('Unknown import option');
 const apply=args.includes('--apply');const url=new URL(process.env.DATABASE_URL||'http://missing');
 if(apply && !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname) && !args.includes('--approved-hosted'))throw Error('Hosted writes require explicit approval and --approved-hosted');
 const text=fs.readFileSync(filename,'utf8'),rows=parseCsv(text);
 const report=await importV5(getPrisma(),rows,{apply,checksum:checksum(text+JSON.stringify(require('../data/imports/ingredient-aliases.json'))),filename:path.basename(filename)});if(apply)await require('../src/services/weekly/centralRecipes').importReviewedIngredients(getPrisma());console.log(JSON.stringify(report,null,2));
 }catch(e){console.error(e.code ? `Import/cache preparation failed (${e.code}); inspect IngredientImport before retry` : e.message);process.exitCode=1;}finally{await getPrisma().$disconnect();}})();
