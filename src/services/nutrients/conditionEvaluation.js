const {Prisma}=require('@prisma/client');
const {normalizeAmount}=require('../nutrientImport');
const ACTIONS=['LIMIT','MONITOR','PRIORITIZE','AVOID_IF_INDICATED'];
const SCOPES=['GENERAL','CONDITION','LAB_DEPENDENT','MEDICATION','CLINICIAN'];
function validCriteria(c) {
 return !!(c && SCOPES.includes(c.scope) && Array.isArray(c.requirements) && c.requirements.every(r=>r && typeof r.key==='string' && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(r.key) && ['string','number','boolean'].includes(typeof r.equals) && (typeof r.equals!=='number'||Number.isFinite(r.equals)) && Object.keys(r).every(k=>['key','equals'].includes(k))) && new Set(c.requirements.map(r=>r.key)).size===c.requirements.length && Object.keys(c).every(k=>['scope','requirements'].includes(k)));
}
function evidenceValid(e) {return !!(e?.organization && e.guidelineTitle && /^https:\/\//.test(e.sourceUrl||'') && e.evidenceNotes && e.lastReviewedAt && Number.isFinite(new Date(e.lastReviewedAt).getTime()) && new Date(e.lastReviewedAt)<=new Date());}
function decimal(v) {if(v==null || v==='')return null;try {const d=new Prisma.Decimal(v);return d.isFinite() && d.gte(0)?d:null;}catch{return null;}}
// Pure evaluation. Context and clinicianLimits must come from trusted, voluntarily supplied records.
function evaluate({conditions=[],profile,servingGrams,context={},clinicianLimits=[],ingredientEvidence=[],nutrientRules=[],ingredientRules=[]}) {
 const ids=new Set(conditions.filter(c=>c.active!==false).map(c=>c.conditionId||c.id));
 const serving=decimal(servingGrams), findings=[];
 for(const rule of [...nutrientRules,...ingredientRules]) {
  const conditionId=rule.healthConditionId||rule.conditionId;
  if(!ids.has(conditionId)||rule.reviewStatus!=='APPROVED')continue;
  const ingredientRule=!rule.nutrient;
  const action=ingredientRule?rule.clinicalAction:rule.action;
  const result={ruleId:rule.id,ruleCode:rule.code||rule.ruleCode,version:rule.version,condition:rule.healthCondition||rule.condition||{id:conditionId},matchedNutrient:rule.nutrient||null,matchedIngredient:ingredientRule?{id:profile?.ingredientId,attribute:rule.attribute}:null,action,severity:rule.severity||rule.clinicalSeverity,explanation:rule.rationale||rule.reason,evidence:rule.evidence||null,actualQuantity:null,threshold:null,clinicianInstruction:null,personalizationRequirements:[],status:'GUIDANCE',comparison:null};
  const finish=(status,reason)=>{findings.push({...result,status,reason});};
  if(!ACTIONS.includes(action)||!evidenceValid(rule.evidence)||!rule.reviewedBy||!rule.reviewedAt||!Number.isFinite(new Date(rule.reviewedAt).getTime())||new Date(rule.reviewedAt)>new Date()){finish('INSUFFICIENT_DATA','MISSING_EVIDENCE_OR_REVIEW');continue;}
  if(!validCriteria(rule.applicabilityCriteria)){finish('INSUFFICIENT_DATA','UNSUPPORTED_APPLICABILITY');continue;}
  const requirements=rule.applicabilityCriteria.requirements;
  const known=r=>context!=null&&Object.hasOwn(context,r.key)&&context[r.key]!=null&&typeof context[r.key]===typeof r.equals&&(typeof context[r.key]!=='number'||Number.isFinite(context[r.key]));
  if(requirements.some(r=>known(r)&&context[r.key]!==r.equals))continue;
  result.personalizationRequirements=requirements.filter(r=>!known(r)).map(r=>r.key);
  if(result.personalizationRequirements.length){finish('PERSONALIZATION_REQUIRED','MISSING_CLINICAL_CONTEXT');continue;}
  if(ingredientRule) {
   // Absence of an attribute is unknown, never proof of absence of an allergen.
   const fact=profile?.ingredient?.attributes?.find(a=>a.attribute===rule.attribute);
   if(!fact){finish('INSUFFICIENT_DATA','INGREDIENT_CLASSIFICATION_UNKNOWN');continue;}
   const support=ingredientEvidence.find(e=>e.ingredientId===profile.ingredientId&&e.attribute===rule.attribute&&e.evidence&&e.verifiedAt&&Number.isFinite(Date.parse(e.verifiedAt))&&new Date(e.verifiedAt)<=new Date());
   if(!support){finish('INSUFFICIENT_DATA','INGREDIENT_CLASSIFICATION_UNVERIFIED');continue;}
   result.matchedIngredient.attributeEvidence=support;
  } else {
   const n=profile?.nutrients?.find(n=>n.nutrientId===rule.nutrientId);
   const amount=decimal(n?.amountPer100g);
   if(!profile?.verifiedAt||amount==null||!serving||serving.lte(0)){finish('INSUFFICIENT_DATA','VERIFIED_NUTRIENT_AND_SERVING_REQUIRED');continue;}
   result.actualQuantity={value:amount.mul(serving).div(100).toFixed(9),unit:rule.nutrient.unit,basis:'PER_SERVING',servingGrams:serving.toString(),profileId:profile.id,sourceCitation:profile.sourceCitation};
   if(rule.thresholdValue!=null) result.threshold={value:String(rule.thresholdValue),unit:rule.thresholdUnit,basis:rule.thresholdBasis,origin:'GENERAL_RULE'};
   const limits=clinicianLimits.filter(l=>l.ruleCode===result.ruleCode);
   if(limits.length>1){finish('PERSONALIZATION_REQUIRED','MULTIPLE_CLINICIAN_LIMITS');continue;}
   if(limits.length) {
    const l=limits[0];
    if(!l.prescribedBy||!l.recordedAt||!Number.isFinite(Date.parse(l.recordedAt))||new Date(l.recordedAt)>new Date()||!['PER_SERVING','PER_100G','DAILY'].includes(l.basis)){finish('PERSONALIZATION_REQUIRED','INVALID_CLINICIAN_LIMIT');continue;}
    result.clinicianInstruction={...l,origin:'CLINICIAN'};
   }
   const threshold=result.clinicianInstruction||result.threshold;
   if(rule.requiresPersonalization&&!result.clinicianInstruction){finish('PERSONALIZATION_REQUIRED','INDIVIDUAL_LIMIT_REQUIRED');continue;}
   if(threshold) {
    let limit;try {limit=normalizeAmount(threshold.value,threshold.unit,rule.nutrient.unit);}catch {limit=null;}
    if(limit==null){finish('INSUFFICIENT_DATA','INVALID_THRESHOLD');continue;}
    if(['DAILY','OTHER'].includes(threshold.basis)){finish('PERSONALIZATION_REQUIRED','DAILY_TOTAL_OR_OTHER_BASIS_REQUIRED');continue;}
    result.comparison={basis:threshold.basis,unit:rule.nutrient.unit,actual:threshold.basis==='PER_100G'?amount.toString():result.actualQuantity.value,threshold:limit};
    result.comparison.relation=new Prisma.Decimal(result.comparison.actual).cmp(limit)>0?'ABOVE':new Prisma.Decimal(result.comparison.actual).cmp(limit)<0?'BELOW':'EQUAL';
   }
  }
  if(ingredientRule&&rule.requiresPersonalization){finish('PERSONALIZATION_REQUIRED','INDIVIDUAL_INGREDIENT_REVIEW_REQUIRED');continue;}
  finish('GUIDANCE',null);
 }
 const conflicts=[];
 for(let i=0;i<findings.length;i++) for(let j=i+1;j<findings.length;j++) {
  const a=findings[i],b=findings[j];
  const same=a.matchedNutrient?.id && a.matchedNutrient.id===b.matchedNutrient?.id || a.matchedIngredient?.attribute && a.matchedIngredient.attribute===b.matchedIngredient?.attribute;
  if(same&&a.status!=='INSUFFICIENT_DATA'&&b.status!=='INSUFFICIENT_DATA'&&((a.action==='PRIORITIZE'&&['LIMIT','AVOID_IF_INDICATED'].includes(b.action))||(b.action==='PRIORITIZE'&&['LIMIT','AVOID_IF_INDICATED'].includes(a.action))))conflicts.push({ruleIds:[a.ruleId,b.ruleId],status:'PERSONALIZATION_REQUIRED',reason:'CONFLICTING_ACTIONS'});
 }
 const covered=new Set(findings.map(f=>f.condition.id));
 return {findings,conflicts,conditionsWithoutApprovedFindings:[...ids].filter(id=>!covered.has(id)),status:conflicts.length?'PERSONALIZATION_REQUIRED':findings.length?'EVALUATED':'INSUFFICIENT_DATA'};
}
async function evaluateForConditions(prisma,{conditions,profileId,...input}) {
 const ids=conditions.filter(c=>c.active!==false).map(c=>c.conditionId||c.id);
 const [profile,nutrientRules,ingredientRules]=await Promise.all([
  prisma.ingredientNutritionProfile.findUnique({where:{id:profileId},include:{nutrients:true,ingredient:{include:{attributes:true}}}}),
  prisma.healthConditionNutrientRule.findMany({where:{healthConditionId:{in:ids},reviewStatus:'APPROVED'},include:{nutrient:true,evidence:true,healthCondition:true}}),
  prisma.conditionRule.findMany({where:{conditionId:{in:ids},target:'clinical_ingredient',reviewStatus:'APPROVED'},include:{evidence:true,condition:true}}),
 ]);
 return evaluate({...input,conditions,profile,nutrientRules,ingredientRules});
}
module.exports={evaluate,evaluateForConditions,validCriteria,evidenceValid,ACTIONS,SCOPES};
