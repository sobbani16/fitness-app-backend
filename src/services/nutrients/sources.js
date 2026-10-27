const {createHash}=require('node:crypto');
const {NUTRIENTS}=require('../nutrientMaster');
const {normalizeAmount}=require('../nutrientImport');
const VERSION='nutrient-population/2.0.0';
// USDA nutrient numbers are source identities, not fuzzy name matches. No IU, DFE or available-carb substitutions.
const USDA_NUMBERS={208:'ENERGY_KCAL',203:'PROTEIN',205:'CARBOHYDRATE_TOTAL',204:'FAT_TOTAL',606:'FAT_SATURATED',605:'FAT_TRANS',291:'FIBER',269:'SUGAR_TOTAL',539:'SUGAR_ADDED',307:'SODIUM',306:'POTASSIUM',305:'PHOSPHORUS',301:'CALCIUM',303:'IRON',304:'MAGNESIUM',309:'ZINC',601:'CHOLESTEROL',320:'VITAMIN_A_RAE',415:'VITAMIN_B6',418:'VITAMIN_B12',401:'VITAMIN_C',328:'VITAMIN_D',323:'VITAMIN_E_ALPHA_TOCOPHEROL',430:'VITAMIN_K',417:'FOLATE_TOTAL',314:'IODINE',317:'SELENIUM'};
function preparation(description) {
  const text=description.toLowerCase();
  const matches=[];
  for(const [pattern,type] of [[/\bboiled\b/,'BOILED'],[/\bsteamed\b/,'STEAMED'],[/\bfried\b/,'FRIED'],[/\broasted\b/,'ROASTED'],[/\braw\b/,'RAW']]) if(pattern.test(text)) matches.push(type);
  if(matches.length===1 && !(matches[0]==='RAW' && /\b(?:cooked|baked|canned)\b/.test(text))) return {preparationType:matches[0],preparationMethod:description};
  return {preparationType:'OTHER',preparationMethod:description}; // baked, canned, unspecified cooked, ready-to-eat stay distinct verbatim
}
function fromUsda(envelope) {
  const f=envelope.food;
  if(!(envelope.endpoint==='https://api.nal.usda.gov/fdc/v1/foods' || /^https:\/\/fdc\.nal\.usda\.gov\/fdc-datasets\/FoodData_Central_(?:sr_legacy|foundation)_food_json_[0-9-]+\.zip$/.test(envelope.endpoint)) || !/^\d+$/.test(String(f?.fdcId)) || !f.description || !f.publicationDate || !['SR Legacy','Foundation','Survey (FNDDS)'].includes(f.dataType)) throw Error('SOURCE_REQUIRES_REVIEW');
  if(!Number.isFinite(Date.parse(envelope.retrievedAt))) throw Error('MISSING_RETRIEVAL_DATE');
  const amounts=new Map(), sourceNutrients={};
  for(const n of f.foodNutrients || []) {
    const code=USDA_NUMBERS[n.nutrient?.number]; if(!code) continue;
    const master=NUTRIENTS.find(x=>x.code===code);
    const value=normalizeAmount(n.amount,n.nutrient.unitName,master.unit);
    if(amounts.has(code) && amounts.get(code)!==value) throw Error(`CONFLICTING_SOURCE_VALUES:${code}`);
    amounts.set(code,value);sourceNutrients[code]={id:n.nutrient.id,number:n.nutrient.number,name:n.nutrient.name};
  }
  if(![...amounts.values()].some(v=>v!=null)) throw Error('NO_SUPPORTED_NUTRIENTS');
  const checksum=createHash('sha256').update(JSON.stringify(f)).digest('hex');
  const provenance={provider:'USDA FoodData Central',url:`https://fdc.nal.usda.gov/food-details/${f.fdcId}/nutrients`,dataType:f.dataType,publicationDate:f.publicationDate,retrievedAt:envelope.retrievedAt,sha256:checksum,adapter:VERSION,download:envelope.endpoint,basis:'100 g edible portion',verification:'Source record confirmed; source-calculated values are not claimed as laboratory measurements',license:'CC0-1.0'};
  return {name:f.description,source:'USDA',sourceFoodId:String(f.fdcId),sourceDataset:`USDA ${f.dataType} ${f.publicationDate}`,sourceCitation:JSON.stringify(provenance),verifiedAt:envelope.retrievedAt,basis:'PER_100_G',...preparation(f.description),nutrients:NUTRIENTS.map(n=>({code:n.code,unit:n.unit,amountPer100g:amounts.get(n.code)??null})),sourceNutrients,checksum};
}
// IFCT/other government data require an operator-reviewed, explicitly licensed normalized export.
// Quantity mappings are retained in the source file; no guesses about IFCT available carbohydrate.
function fromReviewed(envelope) {
  if(!['IFCT','OTHER'].includes(envelope.record?.source) || envelope.review?.approved!==true || !envelope.review?.licenseEvidence || !envelope.review?.reviewedAt || !envelope.record?.sourceCitation) throw Error('LICENSE_OR_SOURCE_REVIEW_REQUIRED');
  const {prepareRecord}=require('../nutrientImport');
  const record={...envelope.record,verifiedAt:envelope.review.reviewedAt,sourceCitation:JSON.stringify({citation:envelope.record.sourceCitation,review:envelope.review})};prepareRecord(record);
  return {...record,name:envelope.record.name,checksum:createHash('sha256').update(JSON.stringify(envelope)).digest('hex')};
}
module.exports={VERSION,USDA_NUMBERS,preparation,fromUsda,fromReviewed};
