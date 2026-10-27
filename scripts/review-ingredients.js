// Read-only maintenance report. Never edits nutrition or silently promotes verification.
const {getPrisma}=require('../src/lib/prisma');
const allowed=require('../src/services/ingredientCsv').levels;
const level=process.argv[2]||'REVIEW_CONFLICT';
(async()=>{try{if(!allowed.includes(level))throw Error('Specify a valid verification level');const rows=await getPrisma().ingredientCatalog.findMany({where:{verificationLevel:level},orderBy:{id:'asc'}});console.log(JSON.stringify(rows.map(r=>({id:r.id,name:r.name,verificationLevel:r.verificationLevel,reviewRequired:r.reviewRequired,source:r.sourceRecord.source,url:r.sourceRecord.source_url,confirmed:r.sourceRecord.confirmed_nutrients,estimated:r.sourceRecord.estimated_nutrients,warning:r.sourceRecord.verification_explanation,revision:r.importBatch})),null,2));}catch(e){console.error(e.code||e.message);process.exitCode=1;}finally{await getPrisma().$disconnect();}})();
