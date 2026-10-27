const {Prisma}=require('@prisma/client');
const {normalizeAmount}=require('../nutrientImport');
const {validCriteria,evidenceValid,ACTIONS}=require('./conditionEvaluation');
const {NUTRIENTS}=require('../nutrientMaster');
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
function validate(dataset,{allowApproved=false}={}) {
 if(!Array.isArray(dataset.conditions)||!Array.isArray(dataset.evidence)||!Array.isArray(dataset.rules)||dataset.rules.length>500)throw Error('Invalid dataset; maximum 500 rules');
 const evidence=new Map();
 for(const e of dataset.evidence){if(!e.code||evidence.has(e.code)||!evidenceValid(e)||new Date(e.lastReviewedAt)>new Date()||(e.publicationYear!=null&&(!Number.isInteger(e.publicationYear)||e.publicationYear<1900||e.publicationYear>new Date().getFullYear())))throw Error('Invalid or duplicate evidence');evidence.set(e.code,e);}
 const codes=new Set();
 for(const r of dataset.rules){
  if(!r.code||codes.has(r.code)||!dataset.conditions.includes(r.condition)||!evidence.has(r.evidenceCode)||!ACTIONS.includes(r.action)||!['INFO','CAUTION','HIGH'].includes(r.severity)||!r.rationale||!Number.isInteger(r.version)||r.version<1||!['DRAFT','REVIEWED','APPROVED'].includes(r.reviewStatus)||!validCriteria(r.applicabilityCriteria)||typeof r.requiresPersonalization!=='boolean')throw Error('Invalid rule');
  codes.add(r.code);
  if((!!r.nutrientCode)===(!!r.attribute))throw Error('Exactly one nutrient or ingredient attribute required');
  if(['LAB_DEPENDENT','MEDICATION'].includes(r.applicabilityCriteria.scope)&&!r.applicabilityCriteria.requirements.length)throw Error('Clinical context criteria required');
  if(['REVIEWED','APPROVED'].includes(r.reviewStatus)&&(!r.reviewedBy||!r.reviewedAt||!Number.isFinite(Date.parse(r.reviewedAt))||new Date(r.reviewedAt)>new Date()))throw Error('Review identity/date required');
  if(r.reviewStatus==='APPROVED'&&!allowApproved)throw Error('Approved import requires explicit reviewed dataset approval');
  if(r.attribute&&r.thresholdValue!=null)throw Error('Ingredient rules cannot carry nutrient thresholds');
  if(r.nutrientCode){const n=NUTRIENTS.find(n=>n.code===r.nutrientCode);if(!n)throw Error('Unknown nutrient');if(!['PER_SERVING','PER_100G','DAILY','OTHER'].includes(r.thresholdBasis))throw Error('Invalid threshold basis');if(r.thresholdValue!=null){normalizeAmount(r.thresholdValue,r.thresholdUnit,n.unit);if(!r.applicabilityCriteria.requirements.length)throw Error('Threshold population criteria required');}else if(r.thresholdUnit!=null)throw Error('Threshold unit without value');}
 }
 return dataset;
}
async function importConditionRules(prisma,dataset,{apply=false,allowApproved=false}={}) {
 validate(dataset,{allowApproved});
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(6822982482)`;
  const report={applied:apply,conditions:dataset.conditions.length,evidence:dataset.evidence.length,rules:[],created:0};
  const conditions=new Map();
  for(const name of dataset.conditions){
   const aliases=name==='CKD'?['CKD','Chronic Kidney Disease']:name==='PCOS'?['PCOS','Polycystic Ovary Syndrome']:[name];
   const found=await tx.healthCondition.findMany({where:{OR:aliases.map(name=>({name:{equals:name,mode:'insensitive'}}))}});
   if(found.length>1)throw Error(`Ambiguous existing condition: ${name}`);
   conditions.set(name,found[0]||(apply?await tx.healthCondition.create({data:{name}}):{id:`pending:${name}`}));
  }
  const evidence=new Map();
  for(const e of dataset.evidence){
   const old=await tx.ruleEvidence.findUnique({where:{code:e.code}});
   const data={code:e.code,organization:e.organization,guidelineTitle:e.guidelineTitle,sourceUrl:e.sourceUrl,publicationYear:e.publicationYear??null,lastReviewedAt:new Date(e.lastReviewedAt),evidenceNotes:e.evidenceNotes};
   if(old&&Object.keys(data).some(k=>stable(old[k])!==stable(data[k])))throw Error(`Evidence is immutable; use a new evidence code: ${e.code}`);
   evidence.set(e.code,old||(apply?await tx.ruleEvidence.create({data}):{id:`pending:${e.code}`}));
  }
  for(const r of dataset.rules){
   const ingredient=!!r.attribute, model=ingredient?tx.conditionRule:tx.healthConditionNutrientRule;
   const n=ingredient?null:await tx.nutrient.findUnique({where:{code:r.nutrientCode}});if(!ingredient&&!n)throw Error('Seed nutrient definitions first');
   const common={version:r.version,reviewStatus:r.reviewStatus,reviewedBy:r.reviewedBy||null,reviewedAt:r.reviewedAt?new Date(r.reviewedAt):null,evidenceSourceId:evidence.get(r.evidenceCode).id,requiresPersonalization:r.requiresPersonalization,applicabilityCriteria:r.applicabilityCriteria};
   const data=ingredient?{...common,ruleCode:r.code,conditionId:conditions.get(r.condition).id,attribute:r.attribute,target:'clinical_ingredient',action:'clinical',clinicalAction:r.action,clinicalSeverity:r.severity,reason:r.rationale}:{...common,code:r.code,healthConditionId:conditions.get(r.condition).id,nutrientId:n.id,action:r.action,severity:r.severity,rationale:r.rationale,thresholdBasis:r.thresholdBasis,thresholdUnit:r.thresholdValue==null?null:n.unit,thresholdValue:r.thresholdValue==null?null:new Prisma.Decimal(normalizeAmount(r.thresholdValue,r.thresholdUnit,n.unit))};
   const where=ingredient?{ruleCode:r.code}:{code:r.code},old=await model.findUnique({where});
   if(old&&Object.keys(data).every(k=>stable(old[k])===stable(data[k]))){report.rules.push({code:r.code,status:'UNCHANGED'});continue;}
   if(old&&(r.version<=old.version||old.reviewStatus==='APPROVED'))throw Error(`Existing rule protected; increment draft version or create a new reviewed rule code: ${r.code}`);
   if(apply){if(old)await model.update({where,data});else{await model.create({data});report.created++;}}
   report.rules.push({code:r.code,status:apply?'IMPORTED':'READY',reviewStatus:r.reviewStatus});
  }
  return report;
 },{timeout:120000});
}
module.exports={validate,importConditionRules};
