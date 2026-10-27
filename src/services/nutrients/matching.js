const {normalize}=require('../ingredientCatalog');
// Whole, split/dehulled, cultivar and preparation qualifiers are deliberately retained.
const synonyms=[
 ['garbanzo beans','chickpeas'],['garbanzo bean','chickpeas'],['cicer arietinum','chickpeas'],['chickpea','chickpeas'],
 ['toor dal','split pigeon peas'],['tuvar dal','split pigeon peas'],['arhar dal','split pigeon peas'],['cajanus cajan','pigeon peas'],
 ['moong dal','split mung beans'],['mung dal','split mung beans'],['green gram','mung beans'],['moong','mung beans'],['vigna radiata','mung beans'],
 ['masoor dal','split lentils'],['urad dal','split black gram'],['vigna mungo','black gram'],
 ['chana dal','split bengal gram'],['maida','refined wheat flour'],['besan','bengal gram flour'],
 ['ragi','finger millet'],['eleusine coracana','finger millet'],['jowar','sorghum'],['bajra','pearl millet'],
 ['rajma','kidney beans'],['bhindi','okra'],['ladyfinger','okra'],['brinjal','eggplant'],['aubergine','eggplant'],['aata','atta'],
].sort((a,b)=>b[0].length-a[0].length);
const pattern=new RegExp(`\\b(?:${synonyms.map(x=>x[0]).join('|')})\\b`,'g');
function canonical(text) {return normalize(text).replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(pattern,match=>synonyms.find(x=>x[0]===match)[1]);}
function names(ingredient) {return [ingredient.name,...(ingredient.catalog?.aliases||[]),ingredient.sourceMetadata?.description,...Object.values(ingredient.sourceMetadata?.reviewedProfiles||{}).map(p=>p.description)].filter(Boolean).map(canonical);}
function choose(ingredient,sources,overrides=[]) {
 const explicit=overrides.filter(x=>x.ingredientId===ingredient.id);
 if(explicit.length) {
   if(explicit.some(x=>!Number.isFinite(Date.parse(x.reviewedAt)) || Date.parse(x.reviewedAt)>Date.now()) || new Set(explicit.map(x=>JSON.stringify([x.source,String(x.sourceFoodId),x.sourceDataset]))).size!==explicit.length) return {status:'REVIEW_REQUIRED',reason:'INVALID_REVIEWED_MATCH'};
   const found=explicit.map(x=>({override:x,source:sources.find(s=>s.source===x.source && s.sourceFoodId===String(x.sourceFoodId) && (!x.sourceDataset || s.sourceDataset===x.sourceDataset))}));
   if(found.some(x=>!x.source || x.override.approved!==true || !x.override.reason || !x.override.reviewedAt || sources.filter(s=>s.source===x.override.source && s.sourceFoodId===String(x.override.sourceFoodId) && (!x.override.sourceDataset || s.sourceDataset===x.override.sourceDataset)).length!==1)) return {status:'REVIEW_REQUIRED',reason:'INVALID_REVIEWED_MATCH'};
   return {status:'MATCHED',confidence:'REVIEWED_IDENTITY_AND_PREPARATION',sources:found.map(x=>x.source),reviews:explicit};
 }
 const known=names(ingredient);
 const sourceId=ingredient.fdcId || (/USDA/i.test(ingredient.catalog?.sourceRecord?.source||'') ? ingredient.catalog.sourceRecord.source_id : null);
 const linked=sourceId?sources.filter(s=>s.source==='USDA' && s.sourceFoodId===sourceId):[];
 if(sourceId && !linked.length) return {status:'PENDING',reason:'SOURCE_RECORD_UNAVAILABLE',candidates:[sourceId]};
 let candidates=linked.length?linked:sources.filter(s=>known.includes(canonical(s.name)));
 // A known ID alone cannot repair a mismatched description or preparation.
 if(linked.length && !linked.every(s=>known.includes(canonical(s.name)))) return {status:'REVIEW_REQUIRED',reason:'SOURCE_ID_NAME_OR_PREPARATION_CONFLICT',candidates:linked.map(s=>s.sourceFoodId)};
 if(ingredient.catalog?.brand || ingredient.catalog?.restaurantChain) return {status:'PENDING',reason:'PRODUCT_SPECIFIC_SOURCE_REQUIRED'};
 if(candidates.length>1) {
   const indian=candidates.filter(s=>s.source==='IFCT'); if(indian.length===1) candidates=indian;
 }
 if(candidates.length!==1) return {status:candidates.length?'REVIEW_REQUIRED':'PENDING',reason:candidates.length?'AMBIGUOUS_SOURCE_MATCH':/IFCT|ICMR|Indian Food Composition/i.test(ingredient.catalog?.sourceRecord?.source||'')?'IFCT_LICENSE_OR_MATCH_PENDING':'NO_RELIABLE_SOURCE_MATCH',candidates:candidates.map(s=>s.sourceFoodId)};
 return {status:'MATCHED',confidence:linked.length?'EXACT_ID_AND_DESCRIPTION':'EXACT_NAME_OR_SYNONYM_AND_PREPARATION',sources:candidates};
}
function indianPriority(i) {return /\b(?:dal|toor|tuvar|arhar|moong|mung|masoor|urad|chana|chickpea|rajma|gram|soybean|rice|basmati|wheat|atta|maida|besan|ragi|jowar|bajra|millet|okra|bhindi|brinjal|paneer|curd|ghee|cumin|turmeric|mustard)\b/i.test([i.name,...(i.catalog?.aliases||[])].join(' '));}
module.exports={canonical,choose,indianPriority};
